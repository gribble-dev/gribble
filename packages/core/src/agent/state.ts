/**
 * Shared mutable state of one agent session. Every tool pack and the guardrails close over the
 * same object; the runner reads it back when the session ends.
 */
import type { AuditEvent } from "../audit/types.js";
import type { AuditPage, BrowserSession, PageSnapshot } from "../browser/types.js";
import type { GribbleConfig } from "../config/types.js";
import type { Flow, FlowStep } from "../flows/schema.js";
import type { ProjectContext } from "../project/types.js";
import { normalizeRoute } from "../report/fingerprint.js";
import type { Finding, FlowResult } from "../report/schema.js";
import { collectSecretValues } from "./redact.js";

export interface AgentUsage {
	/** Tool calls made so far. */
	steps: number;
	/** Sum of `usage.totalTokens` over assistant messages. */
	tokens: number;
	input: number;
	output: number;
	costUsd: number;
}

export interface AgentBudget {
	maxSteps: number;
	maxTokens: number;
	maxCostUsd?: number;
	/** Set by the guardrails when a limit is hit; the runner finalizes with what was collected. */
	exhausted: boolean;
	reason?: string;
	/** The one-time "call finalize_report now" nudge was sent. */
	noticeSent: boolean;
}

export interface FlowRecording {
	name: string;
	startUrl: string;
	steps: FlowStep[];
	startedAt: number;
}

export interface AgentStateOptions {
	project: ProjectContext;
	targetName: string;
	browser: BrowserSession;
	env: NodeJS.ProcessEnv;
	runDir: string;
	/** Routes the orchestrator resolved, and their URLs. */
	routes?: string[];
	urls?: Record<string, string>;
	flows?: Flow[];
	deterministicSummary?: string;
	/** Pre-opened page (login flows). Registered under its own viewport name. */
	page?: AuditPage;
	/** Auth profile for pages the session opens. */
	authProfile?: string;
	/** Write `<name>.replay.json` sidecars for successful flows. Default true. */
	recordReplays?: boolean;
	vision?: boolean;
	onEvent?: (event: AuditEvent) => void;
	signal?: AbortSignal;
}

export class AgentState {
	readonly project: ProjectContext;
	readonly config: GribbleConfig;
	readonly targetName: string;
	readonly browser: BrowserSession;
	readonly env: NodeJS.ProcessEnv;
	readonly runDir: string;
	readonly routes: string[];
	readonly urls: Record<string, string>;
	readonly flows: Flow[];
	readonly deterministicSummary?: string;
	readonly authProfile?: string;
	readonly recordReplays: boolean;
	readonly vision: boolean;
	readonly signal?: AbortSignal;
	readonly secrets: string[];
	readonly onEvent?: (event: AuditEvent) => void;

	/** Open pages by viewport name. */
	readonly pages = new Map<string, AuditPage>();
	currentViewport: string;
	lastSnapshot?: PageSnapshot;
	lastSnapshotViewport?: string;
	/** Normalized route of the current page, best effort. */
	currentRoute = "/";

	readonly findings: Finding[] = [];
	readonly flowResults: FlowResult[] = [];
	flowRecording?: FlowRecording;
	readonly proposedFlows: string[] = [];
	readonly replaysWritten: string[] = [];
	/** Screenshots the model asked for, saved under the run dir. */
	readonly screenshots: string[] = [];

	readonly usage: AgentUsage = { steps: 0, tokens: 0, input: 0, output: 0, costUsd: 0 };
	readonly budget: AgentBudget;
	finalized = false;
	summary?: string;
	/** Set when a tool_call blocked by the guardrails should end the run. */
	terminated = false;

	constructor(opts: AgentStateOptions) {
		this.project = opts.project;
		this.config = opts.project.config;
		this.targetName = opts.targetName;
		this.browser = opts.browser;
		this.env = opts.env;
		this.runDir = opts.runDir;
		this.routes = opts.routes ?? [];
		this.urls = opts.urls ?? {};
		this.flows = opts.flows ?? opts.project.flows;
		this.deterministicSummary = opts.deterministicSummary;
		this.authProfile = opts.authProfile;
		this.recordReplays = opts.recordReplays ?? true;
		this.vision = opts.vision ?? opts.project.config.review.vision;
		this.signal = opts.signal;
		this.onEvent = opts.onEvent;
		this.secrets = collectSecretValues(opts.project.config, opts.env);
		const budget = opts.project.config.budget;
		this.budget = {
			maxSteps: budget.max_steps,
			maxTokens: budget.max_tokens,
			maxCostUsd: budget.max_cost_usd,
			exhausted: false,
			noticeSent: false,
		};
		const viewports = Object.keys(opts.project.config.viewports);
		this.currentViewport = viewports.includes("desktop") ? "desktop" : (viewports[0] ?? "desktop");
		if (opts.page) {
			this.pages.set(opts.page.viewport, opts.page);
			this.currentViewport = opts.page.viewport;
		}
	}

	get viewportNames(): string[] {
		return Object.keys(this.config.viewports);
	}

	emit(event: AuditEvent): void {
		this.onEvent?.(event);
	}

	log(level: "debug" | "info" | "warn" | "error", message: string): void {
		this.emit({ type: "log", level, message });
	}

	/** The page of the current viewport, opened on first use. */
	async currentPage(): Promise<AuditPage> {
		return this.pageFor(this.currentViewport);
	}

	async pageFor(viewport: string): Promise<AuditPage> {
		const existing = this.pages.get(viewport);
		if (existing) return existing;
		if (!this.config.viewports[viewport] && !this.pages.has(viewport)) {
			throw new Error(`Unknown viewport "${viewport}". Configured: ${this.viewportNames.join(", ")}`);
		}
		const page = await this.browser.newPage({ viewport, authProfile: this.authProfile });
		this.pages.set(viewport, page);
		return page;
	}

	/** Resolve a path or URL against the target URL. */
	resolveUrl(input: string): string {
		return new URL(input, this.config.target.url).toString();
	}

	/** Update `currentRoute` from a URL: a resolved route whose URL matches wins, else the normalized path. */
	trackUrl(url: string): string {
		const normalizedUrl = stripHashAndSlash(url);
		for (const [route, routeUrl] of Object.entries(this.urls)) {
			if (stripHashAndSlash(routeUrl) === normalizedUrl) {
				this.currentRoute = route;
				return route;
			}
		}
		this.currentRoute = normalizeRoute(url);
		return this.currentRoute;
	}

	/** Append a replay step when a flow is being recorded. */
	recordStep(step: FlowStep): void {
		this.flowRecording?.steps.push(step);
	}

	/** Add a finding unless the fingerprint is already known; emits the `finding` event. */
	addFinding(finding: Finding): boolean {
		if (this.findings.some((f) => f.fingerprint === finding.fingerprint)) return false;
		this.findings.push(finding);
		this.emit({ type: "finding", finding });
		return true;
	}

	emitBudget(): void {
		this.emit({
			type: "budget",
			steps: this.usage.steps,
			maxSteps: this.budget.maxSteps,
			tokens: this.usage.tokens,
			maxTokens: this.budget.maxTokens,
			costUsd: this.usage.costUsd,
		});
	}

	/** Close every page this session opened (not pages handed in from outside). */
	async closePages(opts: { keep?: AuditPage } = {}): Promise<void> {
		for (const [viewport, page] of this.pages) {
			if (page === opts.keep) continue;
			this.pages.delete(viewport);
			try {
				await page.close();
			} catch {
				// the browser may already be gone
			}
		}
	}
}

function stripHashAndSlash(url: string): string {
	try {
		const u = new URL(url);
		u.hash = "";
		if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
		return u.toString();
	} catch {
		return url;
	}
}
