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
import type { Flow } from "../flows/schema.js";
import { replayFlow } from "../gate/replay.js";
import { discoverRoutes } from "../repo/routes.js";
import { type DesignTokens, readDesignTokens } from "../repo/tokens.js";
import {
	baselineStatusFor,
	buildCompleteness,
	evaluateCoverage,
	type NotExecuted,
	notRunEntry,
} from "../report/completeness.js";
import { applyRulePolicy, dedupeFindings, sortFindings } from "../report/findings.js";
import { normalizeRoute } from "../report/fingerprint.js";
import type {
	Completeness,
	Finding,
	FlowResult,
	NotRunCheck,
	Report,
	RouteResult,
} from "../report/schema.js";
import { summarizeReport } from "../report/summary.js";
import { RUNS_DIR, runDirName, writeRunReport } from "../report/write.js";
import { getRule } from "../rules/registry.js";
import { formatUnimplementedRulesWarning, unimplementedEnabledRules } from "../rules/unimplemented.js";
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
	// Enabled rules with no checker resolve like any other rule and then do nothing; say so up front.
	const unimplementedWarning = formatUnimplementedRulesWarning(unimplementedEnabledRules(project.rules));
	if (unimplementedWarning) log("warn", unimplementedWarning);

	const gateFindings: Finding[] = [];
	const aiFindings: Finding[] = [];
	let reviewRan = false;
	const flowResults: FlowResult[] = [];
	const routeResults: RouteResult[] = [];
	// Checks that could not run, one entry per rule and route (viewports collapse into one).
	const notRun: NotRunCheck[] = [];
	const notRunKeys = new Set<string>();
	const recordNotRun = (entries: NotRunCheck[]) => {
		for (const entry of entries) {
			const key = `${entry.rule}\u0000${entry.route ?? ""}`;
			if (notRunKeys.has(key)) continue;
			notRunKeys.add(key);
			notRun.push(entry);
		}
	};
	const perRoute = new Map<string, RouteCheckResult>();
	// Routes and flows that did not execute, with why. Filled while running, completed after.
	const routeNotChecked = new Map<string, NotExecuted>();
	const flowNotRun = new Map<string, NotExecuted>();
	const reachedFlows = new Set<string>();
	let unresolvedRoutes: string[] = [];
	let review: Completeness["review"] = { status: "not-requested" };
	const screenshots = new Map<string, Buffer>();
	const snapshots: Record<string, string> = {};
	let usage = { steps: 0, tokens: 0, costUsd: 0 };
	let browser: BrowserSession | undefined;
	let renderPlatformRecorded: { os: string; arch: string; browser: string } | undefined;
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
		renderPlatformRecorded = renderPlatform(browser);

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
		unresolvedRoutes = resolved.skipped;
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
							if (viewport === desktop && !routeNotChecked.has(route))
								routeNotChecked.set(route, {
									code: "error",
									reason: `checks failed: ${(err as Error).message}`,
								});
							emit({ type: "route:end", route, viewport, durationMs: Date.now() - routeStarted });
							continue;
						}
						gateFindings.push(...result.findings);
						if (result.notRun) recordNotRun(result.notRun);
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
				const siteStarted = Date.now();
				let siteError: string | undefined;
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
					siteError = `failed: ${(err as Error).message}`;
					recordNotRun([notRunEntry("site/*", "error", siteError)]);
				}
				emit({
					type: "check:end",
					rule: "site/*",
					durationMs: Date.now() - siteStarted,
					ok: !siteError,
					...(siteError ? { error: siteError } : {}),
				});
			} else {
				recordNotRun([notRunEntry("site/*", "aborted", "the run stopped before site-wide checks")]);
			}

			// Replay recorded flows.
			for (const flow of project.flows) {
				if (aborted()) break;
				if (!flow.replay) continue;
				if (!flowInEnvironment(flow, project.environment)) continue;
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
					flowNotRun.set(flow.name, {
						code: "no-model",
						reason: `auth profile "${profileName}" logs in through the reviewer model, and none was resolved`,
					});
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
				const { findings: _drop, notReached, ...flowResult } = result;
				flowResults.push(flowResult);
				if (notReached) flowNotRun.set(flow.name, notReached);
				else reachedFlows.add(flow.name);
			}

			// Regressions against the baseline.
			if (!aborted() && baseline && !bootstrap) {
				emit({ type: "check:start", rule: "regression/*" });
				const regressionStarted = Date.now();
				let regressionError: string | undefined;
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
							platform: renderPlatform(browser),
							onEvent: options.onEvent,
						})),
					);
				} catch (err) {
					regressionError = `failed: ${(err as Error).message}`;
					recordNotRun([notRunEntry("regression/*", "error", regressionError)]);
				}
				emit({
					type: "check:end",
					rule: "regression/*",
					durationMs: Date.now() - regressionStarted,
					ok: !regressionError,
					...(regressionError ? { error: regressionError } : {}),
				});
			}
		}

		// ----------------------------------------------------------------- review
		if ((mode === "review" || mode === "all") && !aborted()) {
			if (!model) {
				log(
					options.ci ? "warn" : "error",
					"Review skipped: no reviewer model was resolved. Run `gribble login` or set `model` in gribble.yaml.",
				);
				review = { status: "skipped", code: "no-model", reason: "no reviewer model was resolved" };
			} else {
				emit({ type: "phase", phase: "review", message: "The reviewer gribble is reading the pages…" });
				try {
					const session = await runReviewSession({
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
					aiFindings.push(...session.findings);
					flowResults.push(...session.flows);
					for (const flow of session.flows) reachedFlows.add(flow.name);
					usage = session.usage;
					review = session.budgetExhausted
						? { status: "incomplete", code: "budget-exhausted", reason: session.budgetExhausted }
						: aborted()
							? { status: "incomplete", code: "aborted", reason: "the run stopped during the review" }
							: { status: "complete" };
				} catch (err) {
					log("error", `Review failed: ${(err as Error).message}`);
					review = {
						status: "incomplete",
						code: "error",
						reason: `review failed: ${(err as Error).message}`,
					};
				}
			}
		}
	} finally {
		await browser?.close().catch(() => {});
		await devServer?.stop().catch(() => {});
	}
	if (aborted()) log("warn", "Audit aborted; the report covers what was checked so far.");
	if ((mode === "review" || mode === "all") && review.status === "not-requested")
		review = { status: "incomplete", code: "aborted", reason: "the run stopped before the review" };

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
	const findingsHeadline = summary.headline;
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
	if (notRun.length > 0) report.notRun = notRun;

	// ----------------------------------------------------------- completeness
	const flowsInScope = project.flows.filter((flow) => {
		if (flowInEnvironment(flow, project.environment)) return true;
		flowNotRun.set(flow.name, {
			code: "excluded",
			reason: `limited to ${flow.env?.join(", ")}; this run is ${project.environment}`,
		});
		return false;
	});
	// A flow the reviewer walked counts as run even when its replay never got past the start.
	for (const name of reachedFlows) flowNotRun.delete(name);
	for (const flow of flowsInScope) {
		if (reachedFlows.has(flow.name) || flowNotRun.has(flow.name)) continue;
		flowNotRun.set(flow.name, whyFlowDidNotRun(mode, review, aborted()));
	}
	const routeNotCheckedReason = (route: string): NotExecuted | undefined => {
		if (!ranGate) {
			// Review-only runs hand the routes to the reviewer; they are unchecked only when it never ran.
			return reviewRan
				? undefined
				: { code: review.code ?? "error", reason: review.reason ?? "the review did not run" };
		}
		const failed = routeNotChecked.get(route);
		if (failed) return failed;
		const result = perRoute.get(route);
		if (!result)
			return aborted()
				? { code: "aborted", reason: "the run stopped before this route" }
				: { code: "error", reason: "no check result was recorded" };
		if (result.unreachable) return { code: "unreachable", reason: result.unreachable };
		return undefined;
	};
	const checkedRoutes: string[] = [];
	const notCheckedRoutes: Array<NotExecuted & { route: string }> = unresolvedRoutes.map((route) => ({
		route: normalizeRoute(route),
		code: "unresolved",
		reason: "no link on the crawled pages matches this dynamic route",
	}));
	for (const route of routes) {
		const why = routeNotCheckedReason(route);
		if (why) notCheckedRoutes.push({ route: normalizeRoute(route), ...why });
		else checkedRoutes.push(route);
	}
	const completeness = buildCompleteness({
		routes: { requested: routes.length + unresolvedRoutes.length, notChecked: notCheckedRoutes },
		flows: {
			requested: project.flows.length,
			ran: project.flows.filter((f) => reachedFlows.has(f.name)).length,
			notRun: [...flowNotRun].map(([flow, why]) => ({ flow, ...why })),
		},
		notRun,
		review,
	});

	let compared = checkedRoutes.length;
	if (baseline && !bootstrap && ranGate) {
		const known = new Set([...Object.keys(baseline.metrics), ...baseline.findings.map((f) => f.route)]);
		const notComparable = checkedRoutes
			.filter((route) => !known.has(normalizeRoute(route)))
			.map((route) => ({ route: normalizeRoute(route), reason: "not in the baseline yet" }));
		compared = checkedRoutes.length - notComparable.length;
		report.baseline.routes = { compared, notComparable };
	}
	report.baseline.status = baselineStatusFor({
		present: !!baseline,
		bootstrap,
		compared,
		checked: checkedRoutes.length,
	});
	report.completeness = completeness;
	const required = evaluateCoverage({ ...report, completeness }, project.config.coverage?.required);
	if (required) {
		completeness.required = required;
		if (!required.ok) {
			// Applied after the bootstrap pass: a project that requires coverage opted out of the lenient first run.
			summary.gate = "fail";
			summary.headline = `${findingsHeadline} Required coverage did not execute: ${required.missing.length} missing.`;
		}
	}

	if ((options.updateBaseline || bootstrap) && !aborted()) {
		const screenshotsMode = project.config.baseline.screenshots;
		const baselineScreenshots: Record<string, Uint8Array> = {};
		if (screenshotsMode !== "off") {
			for (const [key, png] of screenshots) baselineScreenshots[key] = await encodeBaselineScreenshot(png);
			if (screenshotsMode === "lfs" && !(await gitLfsAvailable(env))) {
				log(
					"warn",
					"baseline.screenshots is `lfs` but `git lfs` is not installed. The screenshots and a .gitattributes were written; install Git LFS (https://git-lfs.com) before committing, or switch to `commit`.",
				);
			}
		}
		await writeBaseline(project.gribbleDir, {
			report,
			snapshots,
			screenshots: baselineScreenshots,
			auditedRoutes: incremental ? routes : undefined,
			viewports: project.config.viewports,
			platform: renderPlatformRecorded,
			screenshotsMode,
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

/** Flows limited to other environments (`env:` in the frontmatter) are left out of this run. */
function flowInEnvironment(flow: Flow, environment: string | undefined): boolean {
	return !(flow.env && flow.env.length > 0 && environment && !flow.env.includes(environment));
}

/** Why an in-scope flow has no result, from what this mode could do with it. */
function whyFlowDidNotRun(
	mode: AuditOptions["mode"],
	review: Completeness["review"],
	aborted: boolean,
): NotExecuted {
	const reviewWalks = mode === "review" || mode === "all";
	if (aborted) return { code: "aborted", reason: "the run stopped before this flow" };
	if (!reviewWalks)
		return {
			code: "replay-missing",
			reason: "no recorded replay (flows/<name>.replay.json); gate mode only replays recorded flows",
		};
	if (review.code && review.status !== "complete") return { code: review.code, reason: review.reason ?? "" };
	return { code: "not-reached", reason: "the reviewer did not walk this flow" };
}

/** OS, CPU architecture and browser build of this run; pixel baselines only compare within one platform. */
function renderPlatform(
	browser: BrowserSession | undefined,
): { os: string; arch: string; browser: string } | undefined {
	if (!browser) return undefined;
	return { os: process.platform, arch: process.arch, browser: browser.version() };
}

async function gitLfsAvailable(env: NodeJS.ProcessEnv): Promise<boolean> {
	const { execFile } = await import("node:child_process");
	return new Promise((resolve) => {
		execFile("git", ["lfs", "version"], { env }, (error) => resolve(!error));
	});
}
