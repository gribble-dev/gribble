import type { AuditEvent } from "../audit/types.js";
import type { Baseline } from "../baseline/schema.js";
import type { AuditPage, BrowserSession, GotoResult, PageSnapshot } from "../browser/types.js";
import type { ProjectContext } from "../project/types.js";
import type { DesignTokens } from "../repo/tokens.js";
import type { Finding, NotRunCheck, RouteMetrics } from "../report/schema.js";
import type { LinkCache } from "./link-cache.js";

/** State shared by every check in one audit run (link cache, one-time site checks). */
export interface SharedCheckState {
	links: LinkCache;
	/** Rules that were already reported once per run (favicon, https-only). */
	reportedOnce: Set<string>;
}

export interface CheckContext {
	project: ProjectContext;
	page: AuditPage;
	/** Normalized route, e.g. `/blog/[slug]`. */
	route: string;
	/** URL that was loaded. */
	url: string;
	viewport: string;
	targetName: string;
	baseline?: Baseline;
	runDir: string;
	tokens?: DesignTokens;
	routeSource?: Record<string, string>;
	signal?: AbortSignal;
	onEvent?: (e: AuditEvent) => void;
	shared?: SharedCheckState;
	/** Rules a check skipped on this route; `runRouteChecks` hands them back as `notRun`. */
	notRun?: NotRunCheck[];
	/** Lazily filled caches so checks do not repeat page work. */
	cache?: {
		snapshot?: PageSnapshot;
		html?: string;
		/** Served document source, see `getSource`. */
		source?: string;
		text?: string;
		navigation?: GotoResult;
	};
}

export interface RouteCheckResult {
	findings: Finding[];
	metrics: RouteMetrics;
	ariaSnapshot: string;
	screenshot?: Buffer;
	/** Document status of the route. */
	status?: number;
	title?: string;
	finalUrl?: string;
	/** `href` of the first icon link, empty string when the page declares none. */
	faviconHref?: string;
	/** hreflang values declared on the page. */
	hreflangs?: string[];
	/** Set when the document did not load (network error or HTTP >= 400): why, e.g. `HTTP 404`. */
	unreachable?: string;
	/** Checks that did not run on this route (Lighthouse failure, non-HTML response, a check that threw). */
	notRun?: NotRunCheck[];
	durationMs?: number;
}

export interface SiteWideOptions {
	project: ProjectContext;
	browser: BrowserSession;
	routes: string[];
	perRoute: Map<string, RouteCheckResult>;
	targetName: string;
	shared?: SharedCheckState;
	onEvent?: (e: AuditEvent) => void;
	signal?: AbortSignal;
}

export interface RegressionOptions {
	project: ProjectContext;
	targetName: string;
	routes: string[];
	perRoute: Map<string, RouteCheckResult>;
	baseline: Baseline | undefined;
	/** `route@viewport` -> PNG. */
	screenshots: Map<string, Buffer>;
	baselineDir: string;
	runDir: string;
	/** Where this run rendered its screenshots; compared with `baseline.meta.platform`. */
	platform?: { os: string; arch: string; browser: string };
	onEvent?: (e: AuditEvent) => void;
}
