/**
 * Browser layer contract. The agent tool packs and the deterministic checks both talk to pages
 * through `AuditPage`; nothing outside this folder touches Playwright directly except Lighthouse.
 */
import type { Page } from "playwright";
import type { Flow } from "../flows/schema.js";
import type { ProjectContext } from "../project/types.js";

export interface ViewportSize {
	width: number;
	height: number;
}

export interface ConsoleEntry {
	level: "error" | "warning" | "info" | "log";
	text: string;
	url?: string;
}

export interface FailedRequest {
	url: string;
	method: string;
	status?: number;
	failure?: string;
	resourceType?: string;
}

/** A request the page made during load, kept for network and perf checks. */
export interface RequestRecord {
	url: string;
	method: string;
	resourceType?: string;
	status?: number;
	/** Transfer size in bytes when known (content-length or body size). */
	bytes?: number;
	headers?: Record<string, string>;
}

export interface InteractiveElement {
	/** Stable per-snapshot reference such as `e12`; resets on every snapshot. */
	ref: string;
	role: string;
	name: string;
	tag: string;
	selector: string;
	testId?: string;
	id?: string;
	box: { x: number; y: number; width: number; height: number };
	disabled?: boolean;
	href?: string;
}

export interface SelectorMatch {
	count: number;
	/** The first match is the element behind the ref (true when no ref was given or it is gone). */
	sameElement: boolean;
}

export interface LayoutIssue {
	kind: "overlap" | "overflow-x" | "small-touch-target" | "text-clipped" | "offscreen";
	refs: string[];
	detail: string;
	/** Selectors of the elements involved, parallel to `refs` when available. */
	selectors?: string[];
}

export interface StyleViolation {
	kind: "color" | "font-size" | "spacing" | "min-font-size";
	ref: string;
	selector: string;
	property: string;
	value: string;
	expected?: string;
	/** Visible text of the element, trimmed, for messages. */
	text?: string;
}

export interface PageSnapshot {
	url: string;
	title: string;
	status?: number;
	/** Playwright aria snapshot YAML (compact). */
	aria: string;
	/** Simplified DOM: no script/style/svg internals, wrappers collapsed, meaningful attributes kept. */
	dom: string;
	interactive: InteractiveElement[];
	layout: LayoutIssue[];
	/** Only violations against the design tokens, computed in code. */
	styles: StyleViolation[];
	/** Console entries since the last navigation. */
	console: ConsoleEntry[];
	failedRequests: FailedRequest[];
	metrics?: { domNodes: number; requestCount: number; transferKb: number };
}

export interface SnapshotOptions {
	/** Cap for the simplified DOM; deepest subtrees are truncated first. Default 40000. */
	maxChars?: number;
	includeDom?: boolean;
	/** Design tokens used for the style comparison; when omitted no style violations are computed. */
	tokens?: SnapshotTokens;
	/** Minimum font size in CSS px (`ui/min-font-size`). */
	minFontPx?: number;
	/** Minimum touch target in CSS px (`a11y/touch-target`). */
	minTouchPx?: number;
}

/** Design tokens reduced to what the in-page style sampler needs. */
export interface SnapshotTokens {
	colors?: string[];
	fontSizes?: string[];
	spacing?: string[];
}

export interface GotoResult {
	status?: number;
	ok: boolean;
	finalUrl: string;
	/** Response headers of the document request, lowercase names. */
	headers?: Record<string, string>;
	error?: string;
}

export interface AuditPage {
	readonly raw: Page;
	/** Viewport name from gribble.yaml (`mobile`, `desktop` or custom). */
	readonly viewport: string;
	readonly viewportSize: ViewportSize;
	url(): string;
	goto(
		url: string,
		opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeoutMs?: number },
	): Promise<GotoResult>;
	/** `target`: `ref=e12` from the last snapshot, or a Playwright selector (`text=Sign in`, `role=button[name=Save]`, css). */
	click(target: string, opts?: { timeoutMs?: number }): Promise<void>;
	fill(target: string, value: string): Promise<void>;
	press(key: string): Promise<void>;
	waitFor(opts: { selector?: string; url?: string; text?: string; timeoutMs?: number }): Promise<void>;
	snapshot(opts?: SnapshotOptions): Promise<PageSnapshot>;
	text(selector?: string): Promise<string>;
	/** PNG bytes. */
	screenshot(opts?: { fullPage?: boolean; path?: string }): Promise<Buffer>;
	drainConsole(): ConsoleEntry[];
	drainFailedRequests(): FailedRequest[];
	/** Requests seen since the last navigation (not drained). */
	requests(): RequestRecord[];
	resolveRef(ref: string): Promise<InteractiveElement | undefined>;
	/**
	 * How many elements `selector` matches on the live page and, when `ref` is given, whether the
	 * first match is the element behind that snapshot ref. Invalid selectors match nothing.
	 * Optional for fakes.
	 */
	matchSelector?(selector: string, ref?: string): Promise<SelectorMatch>;
	/** Document status and headers of the last `goto`. */
	lastNavigation(): GotoResult | undefined;
	/** Body of the last document response as served, undefined when there is none. Optional for fakes. */
	documentSource?(): Promise<string | undefined>;
	close(): Promise<void>;
}

export interface BrowserSession {
	readonly baseUrl: string;
	/** One BrowserContext per (`authProfile` ?? "anonymous"); storageState is loaded and cached per profile. */
	newPage(opts?: { viewport?: string; authProfile?: string }): Promise<AuditPage>;
	/** Chrome DevTools endpoint, for Lighthouse. */
	cdpEndpoint(): Promise<string>;
	/** Remote debugging port of the launched browser. */
	cdpPort(): number;
	/** Browser name and version, e.g. `chromium 143.0.7000.0`; recorded next to baseline screenshots. */
	version(): string;
	close(): Promise<void>;
}

export interface LaunchBrowserOptions {
	project: ProjectContext;
	env?: NodeJS.ProcessEnv;
	headless?: boolean;
	runDir?: string;
	/** Runs the login flow with the agent for auth profiles of type `flow`. Returns true when logged in. */
	authFlowRunner?: (opts: { profile: string; flow: Flow; page: AuditPage }) => Promise<boolean>;
	onLog?: (level: "debug" | "info" | "warn" | "error", message: string) => void;
}
