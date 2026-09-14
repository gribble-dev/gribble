/**
 * The audit orchestrator: prepare -> dev server -> routes -> gate -> review -> baseline -> report.
 * Emits `AuditEvent`s throughout, honors `signal`, always closes the browser and the dev server.
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { runAuthFlow, runReviewSession, summarizeForPrompt } from "../agent/index.js";
import { diffAgainstBaseline } from "../baseline/diff.js";
import { baselinePaths, readBaseline, writeBaseline } from "../baseline/io.js";
import type { Baseline } from "../baseline/schema.js";
import { routeSlug } from "../baseline/slug.js";
import { launchBrowser } from "../browser/session.js";
import type { AuditPage, BrowserSession } from "../browser/types.js";
import { LinkCache } from "../checks/link-cache.js";
import { checkRegressions, encodeBaselineScreenshot } from "../checks/regressions.js";
import { runRouteChecks } from "../checks/route.js";
import { checkSiteWide } from "../checks/site-wide.js";
import type { CheckContext, RouteCheckResult, SharedCheckState } from "../checks/types.js";
import { replayFlow } from "../gate/replay.js";
import { discoverRoutes } from "../repo/routes.js";
import { type DesignTokens, readDesignTokens } from "../repo/tokens.js";
import { applyRulePolicy, dedupeFindings, sortFindings } from "../report/findings.js";
import { normalizeRoute } from "../report/fingerprint.js";
import type { Finding, FlowResult, Report, RouteResult } from "../report/schema.js";
import { summarizeReport } from "../report/summary.js";
import { RUNS_DIR, runDirName, writeRunReport } from "../report/write.js";
import { getRule } from "../rules/registry.js";
import { GRIBBLE_CORE_VERSION } from "../version.js";
import { startDevServer } from "./dev-server.js";
import { resolveRoutes } from "./routes.js";
import type { AuditEvent, AuditGitInfo, AuditOptions } from "./types.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync("git", args, { cwd, timeout: 5_000 });
		return stdout.trim() || undefined;
	} catch {
		return undefined;
	}
}

/** Fill missing git info from the repository at `cwd`. */
export async function collectGitInfo(cwd: string, given: AuditGitInfo = {}): Promise<AuditGitInfo> {
	const info: AuditGitInfo = { ...given };
	if (!info.commit) info.commit = await git(cwd, ["rev-parse", "HEAD"]);
	if (!info.branch) {
		const branch = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
		if (branch && branch !== "HEAD") info.branch = branch;
	}
	if (!info.remote) info.remote = await git(cwd, ["config", "--get", "remote.origin.url"]);
	for (const key of Object.keys(info) as Array<keyof AuditGitInfo>)
		if (info[key] === undefined) delete info[key];
	return info;
}

/** Viewports to audit: the desktop one always, others when an enabled rule asks for them. */
export function viewportsToAudit(project: AuditOptions["project"]): string[] {
	const configured = Object.keys(project.config.viewports);
	const desktop = configured.includes("desktop") ? "desktop" : configured[0];
	const wanted = new Set<string>(desktop ? [desktop] : []);
	for (const rule of ["ui/horizontal-overflow", "visual/regression"]) {
		const setting = project.rules.get(rule);
		if (setting.severity === "off") continue;
		for (const v of (setting.options.viewports as string[] | undefined) ?? [])
			if (configured.includes(v)) wanted.add(v);
	}
	if (project.rules.get("a11y/touch-target").severity !== "off" && configured.includes("mobile"))
		wanted.add("mobile");
	return [...wanted];
}

function tokensNeeded(project: AuditOptions["project"]): boolean {
	return ["ui/colors-from-tokens", "ui/font-sizes-from-tokens", "ui/spacing-from-tokens"].some(
		(r) => project.rules.get(r).severity !== "off",
	);
}

function perfWanted(project: AuditOptions["project"]): boolean {
	return project.rules.entries().some((e) => e.id.startsWith("perf/"));
}

/** Run a full audit and write the report. Replaces the foundation stub. */
export async function runAudit(options: AuditOptions): Promise<Report> {
	const { project, mode } = options;
	const env = options.env ?? process.env;
	const emit = (event: AuditEvent) => options.onEvent?.(event);
	const log = (level: "debug" | "info" | "warn" | "error", message: string) =>
		emit({ type: "log", level, message });
	const aborted = () => options.signal?.aborted === true;
	const startedAt = new Date();
	const generatedAt = startedAt.toISOString();
	const runsDir =
		project.config.output.dir.startsWith("/") || /^[A-Za-z]:[\\/]/.test(project.config.output.dir)
			? project.config.output.dir
			: join(project.targetDir, project.config.output.dir);
	const runDir = join(runsDir, runDirName(generatedAt));
	const targetName = project.targetName;

	// ---------------------------------------------------------------- prepare
	emit({ type: "phase", phase: "prepare", message: "Waking the gribbles…" });
	await mkdir(runDir, { recursive: true });
	const gitInfo = await collectGitInfo(project.repoRoot, options.git);
	const baseline: Baseline | undefined = await readBaseline(project.gribbleDir);
	const bootstrap = options.bootstrap ?? !baseline;
	if (bootstrap)
		log(
			"info",
			baseline
				? "Bootstrap requested: rebuilding the baseline from this run."
				: "No baseline yet: this run bootstraps one.",
		);

	const gateFindings: Finding[] = [];
	const aiFindings: Finding[] = [];
	let reviewRan = false;
	const flowResults: FlowResult[] = [];
	const routeResults: RouteResult[] = [];
	const perRoute = new Map<string, RouteCheckResult>();
	const screenshots = new Map<string, Buffer>();
	const snapshots: Record<string, string> = {};
	let usage = { steps: 0, tokens: 0, costUsd: 0 };
	let browser: BrowserSession | undefined;
	let devServer: { stop(): Promise<void> } | undefined;
	let routes: string[] = [];
	let urls: Record<string, string> = {};
	let incremental = false;

	try {
		// ----------------------------------------------------------------- server
		if (project.config.target.start) {
			emit({
				type: "phase",
				phase: "server",
				message: `Starting the dev server: ${project.config.target.start}`,
			});
			devServer = await startDevServer({
				command: project.config.target.start,
				cwd: project.targetDir,
				url: project.config.target.url,
				timeoutMs: project.config.target.readyTimeoutMs,
				env,
				signal: options.signal,
				onLog: (line, stream) => log("debug", `[dev ${stream}] ${line}`),
			});
		}

		const model = options.model;
		browser = await launchBrowser({
			project,
			env,
			headless: options.headless ?? true,
			runDir,
			onLog: log,
			authFlowRunner: model
				? ({ profile, flow, page }) =>
						runAuthFlow({
							profile,
							flow,
							page,
							project,
							model,
							agentDir: options.agentDir,
							env,
							signal: options.signal,
							onEvent: options.onEvent,
						})
				: undefined,
		});

		// ----------------------------------------------------------------- routes
		emit({ type: "phase", phase: "routes", message: "Charting the routes…" });
		const discovered = await discoverRoutes(project.targetDir);
		if (discovered.framework)
			log("debug", `Detected ${discovered.framework} with ${discovered.routes.length} route(s).`);
		const resolved = await resolveRoutes({
			project,
			browser,
			discovered,
			changedFiles: options.changedFiles,
			requested: options.routes,
			onEvent: options.onEvent,
			signal: options.signal,
		});
		routes = resolved.routes;
		urls = resolved.urls;
		incremental = resolved.incremental;
		log(
			"info",
			`${routes.length} route(s) to audit${incremental ? " (incremental)" : ""}${resolved.skipped.length ? `, ${resolved.skipped.length} skipped` : ""}.`,
		);

		// ------------------------------------------------------------------- gate
		if (mode === "gate" || mode === "all") {
			emit({
				type: "phase",
				phase: "gate",
				message: `${routes.length} gribbles are nibbling on ${project.config.target.url}…`,
			});
			const shared: SharedCheckState = {
				links: new LinkCache({ extraHeaders: undefined }),
				reportedOnce: new Set(),
			};
			const tokens: DesignTokens | undefined = tokensNeeded(project)
				? await readDesignTokens(project.targetDir)
				: undefined;
			const viewports = viewportsToAudit(project);
			const desktop = viewports[0];
			const lighthouseOn = perfWanted(project);
			const pages = new Map<string, AuditPage>();
			const pageFor = async (viewport: string) => {
				let page = pages.get(viewport);
				if (!page) {
					page = await browser!.newPage({ viewport });
					pages.set(viewport, page);
				}
				return page;
			};
			try {
				for (const route of routes) {
					if (aborted()) break;
					const url = urls[route]!;
					for (const viewport of viewports) {
						if (aborted()) break;
						const routeStarted = Date.now();
						emit({ type: "route:start", route, viewport });
						const page = await pageFor(viewport);
						const ctx: CheckContext = {
							project,
							page,
							route: normalizeRoute(route),
							url,
							viewport,
							targetName,
							baseline,
							runDir,
							tokens,
							routeSource: discovered.source,
							signal: options.signal,
							onEvent: options.onEvent,
							shared,
						};
						let result: RouteCheckResult;
						try {
							result = await runRouteChecks(ctx, {
								lighthouse: viewport === desktop && lighthouseOn,
								cdpPort: browser.cdpPort(),
								screenshot: true,
							});
						} catch (err) {
							log("error", `Checks failed on ${route} (${viewport}): ${(err as Error).message}`);
							emit({ type: "route:end", route, viewport, durationMs: Date.now() - routeStarted });
							continue;
						}
						gateFindings.push(...result.findings);
						if (result.screenshot) screenshots.set(`${route}@${viewport}`, result.screenshot);
						if (viewport === desktop) {
							perRoute.set(route, result);
							if (result.ariaSnapshot) snapshots[route] = result.ariaSnapshot;
						} else {
							const existing = perRoute.get(route);
							if (existing) existing.findings.push(...result.findings);
						}
						emit({ type: "route:end", route, viewport, durationMs: Date.now() - routeStarted });
					}
				}
			} finally {
				for (const page of pages.values()) await page.close().catch(() => {});
			}

			if (!aborted()) {
				emit({ type: "check:start", rule: "site/*" });
				try {
					gateFindings.push(
						...(await checkSiteWide({
							project,
							browser,
							routes,
							perRoute,
							targetName,
							shared,
							onEvent: options.onEvent,
							signal: options.signal,
						})),
					);
				} catch (err) {
					log("warn", `Site-wide checks failed: ${(err as Error).message}`);
				}
				emit({ type: "check:end", rule: "site/*" });
			}

			// Replay recorded flows.
			for (const flow of project.flows) {
				if (aborted()) break;
				if (!flow.replay) continue;
				if (flow.env && flow.env.length > 0 && project.environment && !flow.env.includes(project.environment))
					continue;
				const profileName =
					typeof flow.requiresAuth === "string"
						? flow.requiresAuth
						: flow.requiresAuth === true
							? Object.keys(project.config.auth?.profiles ?? {})[0]
							: undefined;
				const profile = profileName ? project.config.auth?.profiles[profileName] : undefined;
				if (profile?.type === "flow" && !model) {
					log(
						"warn",
						`Flow "${flow.name}" needs auth profile "${profileName}", which logs in through the reviewer model. Skipped in gate mode without a model.`,
					);
					continue;
				}
				const result = await replayFlow({
					flow,
					replay: flow.replay,
					browser,
					project,
					targetName,
					env,
					onEvent: options.onEvent,
					signal: options.signal,
				});
				gateFindings.push(...result.findings);
				const { findings: _drop, ...flowResult } = result;
				flowResults.push(flowResult);
			}

			// Regressions against the baseline.
			if (!aborted() && baseline && !bootstrap) {
				emit({ type: "check:start", rule: "regression/*" });
				try {
					gateFindings.push(
						...(await checkRegressions({
							project,
							targetName,
							routes,
							perRoute,
							baseline,
							screenshots,
							baselineDir: baselinePaths(project.gribbleDir).dir,
							runDir,
							onEvent: options.onEvent,
						})),
					);
				} catch (err) {
					log("warn", `Regression checks failed: ${(err as Error).message}`);
				}
				emit({ type: "check:end", rule: "regression/*" });
			}
		}

		// ----------------------------------------------------------------- review
		if ((mode === "review" || mode === "all") && !aborted()) {
			if (!model) {
				log(
					options.ci ? "warn" : "error",
					"Review skipped: no reviewer model was resolved. Run `gribble login` or set `model` in gribble.yaml.",
				);
			} else {
				emit({ type: "phase", phase: "review", message: "The reviewer gribble is reading the pages…" });
				try {
					const review = await runReviewSession({
						project,
						targetName,
						browser,
						agentDir: options.agentDir,
						ci: options.ci ?? false,
						model,
						routes,
						urls,
						flows: project.flows,
						deterministicSummary: mode === "all" ? summarizeForPrompt(gateFindings) : undefined,
						runDir,
						sessionDir: options.ci ? undefined : join(project.gribbleDir, "sessions"),
						env,
						onEvent: options.onEvent,
						signal: options.signal,
						mode,
					});
					reviewRan = true;
					aiFindings.push(...review.findings);
					flowResults.push(...review.flows);
					usage = review.usage;
				} catch (err) {
					log("error", `Review failed: ${(err as Error).message}`);
				}
			}
		}
	} finally {
		await browser?.close().catch(() => {});
		await devServer?.stop().catch(() => {});
	}
	if (aborted()) log("warn", "Audit aborted; the report covers what was checked so far.");

	// --------------------------------------------------------------- baseline
	emit({
		type: "phase",
		phase: "baseline",
		message: bootstrap ? "Writing the first baseline…" : "Comparing with the baseline…",
	});
	const policy = applyRulePolicy([...gateFindings, ...aiFindings], project.rules, {
		minConfidence: project.config.review.min_confidence,
	});
	const deduped = dedupeFindings(policy);
	// A review-only run never re-checks deterministic rules (and vice versa), so only rules that ran
	// this time may declare a baseline finding fixed.
	const ranGate = mode === "gate" || mode === "all";
	const ranReview = (mode === "review" || mode === "all") && reviewRan;
	const auditedRules = (rule: string): boolean => {
		const meta = getRule(rule);
		const deterministic = meta ? meta.deterministic : !rule.startsWith("review/");
		return deterministic ? ranGate : ranReview;
	};
	const diff = diffAgainstBaseline(deduped, bootstrap ? undefined : baseline, {
		auditedRoutes: routes,
		auditedRules,
	});
	const findings = sortFindings(diff.findings);
	const summary = summarizeReport(findings, { ci: options.ci, fixedCount: diff.fixed.length });
	if (bootstrap && summary.gate === "fail") {
		// Nothing to compare against yet: the first run records the known state instead of blocking.
		summary.gate = "pass";
		summary.headline = `${summary.headline} Recorded as the baseline; nothing blocks until something gets worse.`;
	}

	// ----------------------------------------------------------------- report
	emit({ type: "phase", phase: "report", message: "Writing the log book…" });
	const snapshotsDir = join(runDir, "snapshots");
	const screenshotsDir = join(runDir, "screenshots");
	for (const route of routes) {
		const result = perRoute.get(route);
		const routeResult: RouteResult = { route: normalizeRoute(route), url: urls[route] ?? route };
		if (result?.status !== undefined) routeResult.status = result.status;
		if (result?.metrics && Object.keys(result.metrics).length > 0) routeResult.metrics = result.metrics;
		if (result?.ariaSnapshot) {
			await mkdir(snapshotsDir, { recursive: true });
			const file = join(snapshotsDir, `${routeSlug(route)}.aria.yaml`);
			await writeFile(file, `${result.ariaSnapshot}\n`, "utf8");
			routeResult.snapshot = relative(runDir, file).replace(/\\/g, "/");
		}
		const shots: Record<string, string> = {};
		for (const [key, png] of screenshots) {
			if (!key.startsWith(`${route}@`)) continue;
			const viewport = key.slice(route.length + 1);
			await mkdir(screenshotsDir, { recursive: true });
			const file = join(screenshotsDir, `${routeSlug(route)}@${viewport}.png`);
			await writeFile(file, png);
			shots[viewport] = relative(runDir, file).replace(/\\/g, "/");
		}
		if (Object.keys(shots).length > 0) routeResult.screenshots = shots;
		routeResults.push(routeResult);
	}

	const report: Report = {
		version: 1,
		gribbleVersion: GRIBBLE_CORE_VERSION,
		generatedAt,
		mode,
		target: {
			name: targetName,
			url: project.config.target.url,
			...(project.environment ? { environment: project.environment } : {}),
		},
		budget: {
			steps: usage.steps,
			maxSteps: project.config.budget.max_steps,
			tokens: usage.tokens,
			maxTokens: project.config.budget.max_tokens,
			costUsd: usage.costUsd,
		},
		baseline: {
			present: !!baseline,
			...(baseline?.meta.commit ? { commit: baseline.meta.commit } : {}),
			bootstrap,
		},
		summary,
		findings,
		routes: routeResults,
		flows: flowResults,
		durationMs: Date.now() - startedAt.getTime(),
	};
	if (Object.keys(gitInfo).length > 0) report.repo = gitInfo;
	if (options.model) {
		report.model = {
			provider: options.model.model.provider,
			id: options.model.model.id,
			...(options.model.thinking ? { thinking: options.model.thinking } : {}),
		};
	}
	if (diff.fixed.length > 0) {
		report.fixed = diff.fixed.map((f) => ({
			fingerprint: f.fingerprint,
			rule: f.rule,
			severity: f.severity,
			route: f.route,
		}));
	}

	if ((options.updateBaseline || bootstrap) && !aborted()) {
		const baselineScreenshots: Record<string, Uint8Array> = {};
		if (project.config.baseline.screenshots !== "off") {
			for (const [key, png] of screenshots) baselineScreenshots[key] = await encodeBaselineScreenshot(png);
		}
		await writeBaseline(project.gribbleDir, {
			report,
			snapshots,
			screenshots: baselineScreenshots,
			auditedRoutes: incremental ? routes : undefined,
			viewports: project.config.viewports,
		});
		log(
			"info",
			`Baseline written to ${relative(project.repoRoot, baselinePaths(project.gribbleDir).dir) || "."}.`,
		);
	}

	const written = await writeRunReport(project.gribbleDir, report, {
		keep: project.config.output.keep,
		runsDir: runsDir === join(project.gribbleDir, RUNS_DIR) ? undefined : runsDir,
	});
	log("debug", `Report written to ${written.jsonPath}.`);
	emit({ type: "done", report });
	return report;
}
