/**
 * Session runners: the review session of an audit and the short login-flow session used by the
 * browser layer for `flow` auth profiles.
 */
import type { AuditEvent } from "../audit/types.js";
import type { AuditPage, BrowserSession } from "../browser/types.js";
import type { AuditMode } from "../config/types.js";
import type { Flow } from "../flows/schema.js";
import { usageFromMessages } from "../models/runtime.js";
import type { ModelResolution } from "../models/types.js";
import type { ProjectContext } from "../project/types.js";
import { buildAuditPrompt } from "../prompt/audit.js";
import { buildLoginPrompt, buildLoginSystemPrompt } from "../prompt/login.js";
import type { Finding, FlowResult } from "../report/schema.js";
import { AUTH_FLOW_TOOLS } from "./names.js";
import { createGribbleSession } from "./session.js";

export interface ReviewSessionOptions {
	project: ProjectContext;
	targetName: string;
	browser: BrowserSession;
	agentDir: string;
	ci: boolean;
	/** From `resolveModel`. */
	model: ModelResolution;
	routes: string[];
	urls: Record<string, string>;
	flows: Flow[];
	/** Markdown summary of the gate findings (see `summarizeForPrompt`); injected as context. */
	deterministicSummary?: string;
	runDir: string;
	/** Session files go here when not in CI; default `<gribbleDir>/sessions`. */
	sessionDir?: string;
	env: NodeJS.ProcessEnv;
	onEvent?: (event: AuditEvent) => void;
	signal?: AbortSignal;
	/** Audit mode for the prompt. Default `all` when a deterministic summary is given, else `review`. */
	mode?: AuditMode;
	/** Auth profile for the pages the reviewer opens. */
	authProfile?: string;
}

export interface ReviewSessionResult {
	findings: Finding[];
	flows: FlowResult[];
	usage: { steps: number; tokens: number; costUsd: number };
	sessionFile?: string;
	/** Files written under flows/proposed/. */
	proposedFlows: string[];
	/** Replay sidecars written for successful flows. */
	replaysWritten: string[];
	/** The model's closing summary, when it called finalize_report. */
	summary?: string;
	finalized: boolean;
	/** Set when a budget stopped the session early. */
	budgetExhausted?: string;
}

const FINALIZE_NUDGE =
	"You stopped without calling finalize_report. Call finalize_report now with a two-sentence summary of what you checked. Do not run more tools first.";

export async function runReviewSession(opts: ReviewSessionOptions): Promise<ReviewSessionResult> {
	const mode = opts.mode ?? (opts.deterministicSummary ? "all" : "review");
	const prompt = buildAuditPrompt({ project: opts.project, mode, routes: opts.routes, flows: opts.flows });

	const gribble = await createGribbleSession({
		project: opts.project,
		targetName: opts.targetName,
		browser: opts.browser,
		agentDir: opts.agentDir,
		ci: opts.ci,
		model: opts.model,
		env: opts.env,
		runDir: opts.runDir,
		sessionDir: opts.sessionDir,
		routes: opts.routes,
		urls: opts.urls,
		flows: opts.flows,
		deterministicSummary: opts.deterministicSummary,
		authProfile: opts.authProfile,
		onEvent: opts.onEvent,
		signal: opts.signal,
		packs: "review",
	});
	const { session, state } = gribble;

	const onAbort = () => {
		void session.abort();
	};
	if (opts.signal?.aborted) onAbort();
	else opts.signal?.addEventListener("abort", onAbort, { once: true });

	let usage = usageFromMessages([]);
	let sessionFile: string | undefined;
	try {
		await session.prompt(prompt);
		await session.agent.waitForIdle();
		if (!state.finalized && !state.terminated && !state.budget.exhausted && !opts.signal?.aborted) {
			state.log("info", "The reviewer stopped without finalize_report; asking once more.");
			await session.prompt(FINALIZE_NUDGE);
			await session.agent.waitForIdle();
		}
	} finally {
		opts.signal?.removeEventListener("abort", onAbort);
		usage = usageFromMessages(session.messages);
		sessionFile = session.sessionFile;
		await gribble.dispose();
	}

	return {
		findings: [...state.findings],
		flows: [...state.flowResults],
		usage: { steps: state.usage.steps, tokens: usage.tokens, costUsd: usage.costUsd },
		sessionFile,
		proposedFlows: [...state.proposedFlows],
		replaysWritten: [...state.replaysWritten],
		summary: state.summary,
		finalized: state.finalized,
		budgetExhausted: state.budget.exhausted ? state.budget.reason : undefined,
	};
}

export interface RunAuthFlowOptions {
	profile: string;
	flow: Flow;
	page: AuditPage;
	project: ProjectContext;
	model: ModelResolution;
	agentDir: string;
	env: NodeJS.ProcessEnv;
	signal?: AbortSignal;
	onEvent?: (event: AuditEvent) => void;
	/** Steps the login session may take; default 40, never more than `budget.max_steps`. */
	maxSteps?: number;
}

const LOGIN_PATH =
	/\/(login|log-in|signin|sign-in|auth|session\/new|account\/login|users\/sign_in)(\/|$|\?)/i;

/** True when a URL's path looks like a login page. */
export function looksLikeLoginUrl(url: string): boolean {
	try {
		return LOGIN_PATH.test(new URL(url).pathname);
	} catch {
		return LOGIN_PATH.test(url);
	}
}

/**
 * Walk a login flow with a small dedicated session that only has browser tools. Succeeds when the
 * model reports `flow_end({ ok: true })`, or when it ended without a verdict and the page no longer
 * looks like a login page. Used as `LaunchBrowserOptions.authFlowRunner`.
 */
export async function runAuthFlow(opts: RunAuthFlowOptions): Promise<boolean> {
	const profile = opts.project.config.auth?.profiles[opts.profile];
	const envNames = profile?.type === "flow" ? Object.values(profile.env ?? {}) : [];
	const browser: BrowserSession = {
		baseUrl: opts.project.config.target.url,
		newPage: async () => {
			throw new Error("The login session works on the page it was given; it cannot open more pages.");
		},
		cdpEndpoint: async () => {
			throw new Error("Not available during login.");
		},
		cdpPort: () => 0,
		version: () => opts.page.raw.context().browser()?.version() ?? "unknown",
		close: async () => {},
	};

	const gribble = await createGribbleSession({
		project: opts.project,
		targetName: opts.project.targetName,
		browser,
		agentDir: opts.agentDir,
		ci: true,
		model: opts.model,
		env: opts.env,
		runDir: opts.project.gribbleDir,
		page: opts.page,
		authProfile: opts.profile,
		recordReplays: false,
		vision: false,
		flows: [opts.flow],
		onEvent: opts.onEvent,
		signal: opts.signal,
		packs: "auth",
		initialTools: AUTH_FLOW_TOOLS,
		systemPrompt: buildLoginSystemPrompt({ config: opts.project.config, profile: opts.profile }),
	});
	const { session, state } = gribble;
	state.budget.maxSteps = Math.min(opts.maxSteps ?? 40, state.budget.maxSteps);

	const onAbort = () => {
		void session.abort();
	};
	opts.signal?.addEventListener("abort", onAbort, { once: true });
	try {
		await session.prompt(
			buildLoginPrompt({ flow: opts.flow, envNames, targetUrl: opts.project.config.target.url }),
		);
		await session.agent.waitForIdle();
	} finally {
		opts.signal?.removeEventListener("abort", onAbort);
		await gribble.dispose();
	}

	const verdict = state.flowResults.find((r) => r.name === opts.flow.name) ?? state.flowResults[0];
	if (verdict) return verdict.ok;
	return !looksLikeLoginUrl(opts.page.url());
}
