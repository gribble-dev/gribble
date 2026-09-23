/**
 * Replays a recorded flow (`flows/<name>.replay.json`) step by step. A failed step produces a
 * flows/replay finding; a slow flow produces flows/max-duration.
 */
import type { AuditEvent } from "../audit/types.js";
import { AuthError } from "../browser/auth.js";
import type { AuditPage, BrowserSession } from "../browser/types.js";
import { urlMatcher } from "../browser/url-match.js";
import { makeFinding, ruleOptions, truncate } from "../checks/finding.js";
import type { Flow, FlowReplay, FlowStep } from "../flows/schema.js";
import type { ProjectContext } from "../project/types.js";
import type { Finding, FlowResult } from "../report/schema.js";

export interface ReplayFlowOptions {
	flow: Flow;
	replay: FlowReplay;
	browser: BrowserSession;
	project: ProjectContext;
	targetName: string;
	env: NodeJS.ProcessEnv;
	onEvent?: (e: AuditEvent) => void;
	signal?: AbortSignal;
	/** Auth profile to use; defaults to the flow's `requiresAuth` when it names a profile. */
	authProfile?: string;
	/** Per-step timeout. */
	stepTimeoutMs?: number;
}

export type ReplayFlowResult = FlowResult & {
	findings: Finding[];
	/** Set when the flow failed before its first step: it never executed, so it counts as not run. */
	notReached?: { code: "auth-failed" | "unreachable" | "aborted"; reason: string };
};

const ENV_REF = /^\$\{([A-Z0-9_]+)\}$|^\$([A-Z0-9_]+)$/i;

/** Resolve `${VAR}` / `$VAR` / bare env var names (secret steps) from the environment. */
export function resolveStepValue(value: string, secret: boolean | undefined, env: NodeJS.ProcessEnv): string {
	const ref = value.match(ENV_REF);
	const name = ref ? (ref[1] ?? ref[2]) : secret && /^[A-Z][A-Z0-9_]*$/.test(value) ? value : undefined;
	if (!name) return value;
	const resolved = env[name];
	if (resolved === undefined) throw new Error(`environment variable ${name} is not set`);
	return resolved;
}

function describeStep(step: FlowStep, index: number): string {
	switch (step.action) {
		case "navigate":
			return `step ${index + 1}: navigate ${step.url}`;
		case "click":
			return `step ${index + 1}: click ${step.description ?? step.selector}`;
		case "fill":
			return `step ${index + 1}: fill ${step.selector}`;
		case "press":
			return `step ${index + 1}: press ${step.key}`;
		case "wait_for":
			return `step ${index + 1}: wait for ${step.selector ?? step.text ?? step.url ?? "load"}`;
		case "expect_text":
			return `step ${index + 1}: expect text "${truncate(step.text, 40)}"`;
		case "expect_url":
			return `step ${index + 1}: expect url ${step.pattern}`;
		case "expect_visible":
			return `step ${index + 1}: expect ${step.selector} visible`;
	}
}

function resolveUrl(base: string, target: string): string {
	try {
		return new URL(target, base).toString();
	} catch {
		return target;
	}
}

async function runStep(
	page: AuditPage,
	step: FlowStep,
	opts: { baseUrl: string; env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<void> {
	switch (step.action) {
		case "navigate": {
			const result = await page.goto(resolveUrl(opts.baseUrl, step.url), { timeoutMs: opts.timeoutMs });
			if (!result.ok)
				throw new Error(
					`navigation failed: ${result.status ? `HTTP ${result.status}` : (result.error ?? "no response")}`,
				);
			return;
		}
		case "click":
			await page.click(step.selector, { timeoutMs: opts.timeoutMs });
			return;
		case "fill":
			await page.fill(step.selector, resolveStepValue(step.value, step.secret, opts.env));
			return;
		case "press":
			await page.press(step.key);
			return;
		case "wait_for":
			await page.waitFor({
				selector: step.selector,
				url: step.url,
				text: step.text,
				timeoutMs: step.timeoutMs ?? opts.timeoutMs,
			});
			return;
		case "expect_text": {
			const locator = step.selector
				? page.raw.locator(step.selector).first().getByText(step.text)
				: page.raw.getByText(step.text);
			await locator
				.first()
				.waitFor({ state: "visible", timeout: opts.timeoutMs })
				.catch(async () => {
					const body = step.selector
						? await page.text(step.selector).catch(() => "")
						: await page.text().catch(() => "");
					if (!body.includes(step.text))
						throw new Error(
							`text "${truncate(step.text, 60)}" not found${step.selector ? ` in ${step.selector}` : ""}`,
						);
				});
			return;
		}
		case "expect_url": {
			const matches = urlMatcher(step.pattern);
			if (!matches(page.url())) {
				await page.raw
					.waitForURL((u) => matches(u.toString()), { timeout: Math.min(opts.timeoutMs, 5_000) })
					.catch(() => {});
			}
			if (!matches(page.url())) throw new Error(`url ${page.url()} does not match ${step.pattern}`);
			return;
		}
		case "expect_visible":
			await page.raw.locator(step.selector).first().waitFor({ state: "visible", timeout: opts.timeoutMs });
			return;
	}
}

/** Replay a flow's recorded steps; never throws for step failures. */
export async function replayFlow(opts: ReplayFlowOptions): Promise<ReplayFlowResult> {
	const { flow, replay, project, targetName } = opts;
	const started = Date.now();
	const findings: Finding[] = [];
	const ctx = { project, route: replay.startUrl, targetName, viewport: "", onEvent: opts.onEvent };
	const timeoutMs = opts.stepTimeoutMs ?? 15_000;
	const authProfile =
		opts.authProfile ??
		(typeof flow.requiresAuth === "string"
			? flow.requiresAuth
			: flow.requiresAuth === true
				? Object.keys(project.config.auth?.profiles ?? {})[0]
				: undefined);

	opts.onEvent?.({ type: "flow:start", flow: flow.name });
	let page: AuditPage | undefined;
	let error: string | undefined;
	let steps = 0;
	let notReached: ReplayFlowResult["notReached"];
	try {
		page = await opts.browser.newPage({ authProfile });
		const start = resolveUrl(opts.browser.baseUrl, replay.startUrl);
		const nav = await page.goto(start, { timeoutMs: 30_000 });
		if (!nav.ok) {
			const reason = `start url ${start} failed: ${nav.status ? `HTTP ${nav.status}` : (nav.error ?? "no response")}`;
			// A flow whose first step navigates does not depend on where it starts (older sidecars
			// recorded whatever page the agent was on).
			if (replay.steps[0]?.action !== "navigate") throw new Error(reason);
			opts.onEvent?.({
				type: "log",
				level: "warn",
				message: `flow ${flow.name}: ${reason}; continuing, step 1 navigates`,
			});
		}
		for (const [index, step] of replay.steps.entries()) {
			if (opts.signal?.aborted) throw new Error("aborted");
			try {
				await runStep(page, step, { baseUrl: opts.browser.baseUrl, env: opts.env, timeoutMs });
				steps += 1;
			} catch (err) {
				throw new Error(`${describeStep(step, index)} failed: ${(err as Error).message.split("\n")[0]}`, {
					cause: index,
				});
			}
		}
	} catch (err) {
		error = (err as Error).message;
		const failedIndex =
			typeof (err as Error).cause === "number" ? ((err as Error).cause as number) : undefined;
		if (failedIndex === undefined) {
			notReached = {
				code: opts.signal?.aborted ? "aborted" : err instanceof AuthError ? "auth-failed" : "unreachable",
				reason: error,
			};
		}
		const finding = makeFinding(ctx, "flows/replay", {
			title: `Flow "${flow.name}" fails at ${failedIndex !== undefined ? `step ${failedIndex + 1}` : "the start"}`,
			message: `${error}${page ? ` (page: ${page.url()})` : ""}`,
			subject: failedIndex !== undefined ? `step-${failedIndex + 1}` : "start",
			location: { path: `flows/${flow.name}` },
			evidence: {
				url: page?.url(),
				data: { step: failedIndex !== undefined ? replay.steps[failedIndex] : undefined },
			},
			viewport: null,
		});
		if (finding) {
			findings.push(finding);
			opts.onEvent?.({ type: "finding", finding });
		}
	} finally {
		await page?.close().catch(() => {});
	}
	const durationMs = Date.now() - started;
	if (!error) {
		const { seconds } = ruleOptions<{ seconds: number }>(ctx, "flows/max-duration");
		if (seconds && durationMs > seconds * 1000) {
			const finding = makeFinding(ctx, "flows/max-duration", {
				title: `Flow "${flow.name}" took ${(durationMs / 1000).toFixed(1)}s (limit ${seconds}s)`,
				message: `${replay.steps.length} steps completed in ${(durationMs / 1000).toFixed(1)} seconds.`,
				subject: "duration",
				location: { path: `flows/${flow.name}` },
				viewport: null,
			});
			if (finding) {
				findings.push(finding);
				opts.onEvent?.({ type: "finding", finding });
			}
		}
	}
	opts.onEvent?.({ type: "flow:end", flow: flow.name, ok: !error, durationMs, error });
	const result: ReplayFlowResult = {
		name: flow.name,
		ok: !error,
		kind: "replay",
		durationMs,
		steps,
		findings,
	};
	if (error) result.error = error;
	if (notReached) result.notReached = notReached;
	return result;
}
