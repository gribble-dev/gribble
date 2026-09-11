/**
 * Tool names of the Gribble packs. One place, so the session allowlist, the dynamic loader and
 * the guardrails agree on spelling.
 */

export const BROWSER_TOOLS = {
	navigate: "navigate",
	click: "click",
	fill: "fill",
	press: "press",
	waitFor: "wait_for",
	pageSnapshot: "page_snapshot",
	extractText: "extract_text",
	screenshot: "screenshot",
	listConsoleErrors: "list_console_errors",
	setViewport: "set_viewport",
} as const;

export const CRAWL_TOOLS = { checkLinks: "check_links", enumeratePages: "enumerate_pages" } as const;
export const PERF_TOOLS = { runLighthouse: "run_lighthouse" } as const;
export const A11Y_TOOLS = { runAxe: "run_axe" } as const;
export const SEO_TOOLS = {
	checkMeta: "check_meta",
	checkSitemap: "check_sitemap",
	checkRobots: "check_robots",
} as const;
export const VISUAL_TOOLS = { compareScreenshot: "compare_screenshot" } as const;
export const REPO_TOOLS = {
	listRoutes: "list_routes",
	readDesignTokens: "read_design_tokens",
	mapDomToSource: "map_dom_to_source",
} as const;
export const FLOW_TOOLS = {
	flowStart: "flow_start",
	flowEnd: "flow_end",
	proposeFlow: "propose_flow",
} as const;
export const REPORT_TOOLS = { addFinding: "add_finding", finalizeReport: "finalize_report" } as const;
export const LOADER_TOOL = "search_tools";

/** pi built-in tools Gribble enables: read-only file access, never edit/write/bash. */
export const BUILTIN_TOOLS = ["read", "grep", "find", "ls"] as const;

/** Every Gribble tool, active or not. */
export const ALL_PACK_TOOLS: readonly string[] = [
	...Object.values(BROWSER_TOOLS),
	...Object.values(CRAWL_TOOLS),
	...Object.values(PERF_TOOLS),
	...Object.values(A11Y_TOOLS),
	...Object.values(SEO_TOOLS),
	...Object.values(VISUAL_TOOLS),
	...Object.values(REPO_TOOLS),
	...Object.values(FLOW_TOOLS),
	...Object.values(REPORT_TOOLS),
	LOADER_TOOL,
];

/**
 * Tools active from the first turn of a review session. Everything else stays registered but
 * inactive until `search_tools` loads it. `screenshot` and `set_viewport` are added by the session
 * factory when vision is on / more than one viewport is configured.
 */
export const CORE_TOOLS: readonly string[] = [
	BROWSER_TOOLS.navigate,
	BROWSER_TOOLS.click,
	BROWSER_TOOLS.fill,
	BROWSER_TOOLS.press,
	BROWSER_TOOLS.waitFor,
	BROWSER_TOOLS.pageSnapshot,
	BROWSER_TOOLS.extractText,
	BROWSER_TOOLS.listConsoleErrors,
	REPO_TOOLS.listRoutes,
	REPO_TOOLS.mapDomToSource,
	FLOW_TOOLS.flowStart,
	FLOW_TOOLS.flowEnd,
	FLOW_TOOLS.proposeFlow,
	REPORT_TOOLS.addFinding,
	REPORT_TOOLS.finalizeReport,
	LOADER_TOOL,
];

/** Tools a login-flow session gets: browser actions plus flow markers, nothing that writes. */
export const AUTH_FLOW_TOOLS: readonly string[] = [
	BROWSER_TOOLS.navigate,
	BROWSER_TOOLS.click,
	BROWSER_TOOLS.fill,
	BROWSER_TOOLS.press,
	BROWSER_TOOLS.waitFor,
	BROWSER_TOOLS.pageSnapshot,
	BROWSER_TOOLS.extractText,
	FLOW_TOOLS.flowStart,
	FLOW_TOOLS.flowEnd,
];

/** Tools that may run once the step budget is spent, so the run can still be reported. */
export const BUDGET_EXEMPT_TOOLS: ReadonlySet<string> = new Set([
	REPORT_TOOLS.addFinding,
	REPORT_TOOLS.finalizeReport,
	FLOW_TOOLS.flowEnd,
]);

/** Tools whose arguments can move the browser or type into it. */
export const NAVIGATION_TOOLS: ReadonlySet<string> = new Set([BROWSER_TOOLS.navigate]);
export const INTERACTION_TOOLS: ReadonlySet<string> = new Set([BROWSER_TOOLS.click, BROWSER_TOOLS.fill]);
