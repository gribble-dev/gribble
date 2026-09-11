/**
 * Runs every enabled deterministic per-route check on one page/viewport.
 */
import type { Finding, RouteMetrics } from "../report/schema.js";
import { runAxe } from "./axe.js";
import { ruleEnabled, ruleOptions } from "./finding.js";
import { checkHtml } from "./html.js";
import { checkI18n } from "./i18n.js";
import { lighthouseWanted, runLighthouse } from "./lighthouse.js";
import { checkLinks } from "./links.js";
import { checkNetwork } from "./network.js";
import { setSnapshot } from "./page-data.js";
import { checkSecurity } from "./security.js";
import { checkSeo, readHead } from "./seo.js";
import type { CheckContext, RouteCheckResult } from "./types.js";
import { checkUi } from "./ui.js";

export interface RunRouteChecksOptions {
	/** Run Lighthouse on this route (desktop viewport only, when perf rules are on). */
	lighthouse?: boolean;
	/** CDP port for Lighthouse. */
	cdpPort?: number;
	/** Take a viewport screenshot for visual regression and the run directory. */
	screenshot?: boolean;
	/** Skip navigation because the caller already loaded the page. */
	skipNavigation?: boolean;
}

type Check = { id: string; run: (ctx: CheckContext) => Promise<Finding[]> };

const CHECKS: Check[] = [
	{ id: "network/*", run: checkNetwork },
	{ id: "html/*", run: checkHtml },
	{ id: "seo/*", run: checkSeo },
	{ id: "links/*", run: checkLinks },
	{ id: "ui/*", run: checkUi },
	{ id: "i18n/*", run: checkI18n },
	{ id: "security/*", run: checkSecurity },
	{ id: "a11y/*", run: runAxe },
];

function tokensForSnapshot(ctx: CheckContext) {
	const colorsRule = ctx.project.rules.get("ui/colors-from-tokens", ctx.route);
	const colors =
		colorsRule.severity === "off"
			? undefined
			: Array.isArray(colorsRule.options.tokens)
				? (colorsRule.options.tokens as string[])
				: ctx.tokens && ctx.tokens.colors.size > 0
					? [...ctx.tokens.colors]
					: undefined;
	const fontSizes =
		ruleEnabled(ctx, "ui/font-sizes-from-tokens") && ctx.tokens && ctx.tokens.fontSizes.size > 0
			? [...ctx.tokens.fontSizes]
			: undefined;
	return colors || fontSizes ? { colors, fontSizes } : undefined;
}

/** Navigate (unless told not to), snapshot, run the checks, collect metrics and the screenshot. */
export async function runRouteChecks(
	ctx: CheckContext,
	opts: RunRouteChecksOptions = {},
): Promise<RouteCheckResult> {
	const started = Date.now();
	const findings: Finding[] = [];
	if (!ctx.cache) ctx.cache = {};

	if (!opts.skipNavigation) {
		ctx.cache.navigation = await ctx.page.goto(ctx.url);
	} else {
		ctx.cache.navigation = ctx.page.lastNavigation();
	}
	const nav = ctx.cache.navigation;
	const loaded = !!nav && nav.ok && (nav.status ?? 0) < 400;

	const result: RouteCheckResult = {
		findings,
		metrics: {},
		ariaSnapshot: "",
		status: nav?.status,
		finalUrl: nav?.finalUrl,
	};

	if (!loaded) {
		findings.push(...(await checkNetwork(ctx)).filter((f) => f.rule === "network/page-error"));
		result.durationMs = Date.now() - started;
		return result;
	}

	const snapshot = await ctx.page.snapshot({
		includeDom: false,
		tokens: tokensForSnapshot(ctx),
		minFontPx: ruleEnabled(ctx, "ui/min-font-size")
			? (ruleOptions<{ px: number }>(ctx, "ui/min-font-size").px ?? 12)
			: undefined,
		minTouchPx:
			ruleEnabled(ctx, "a11y/touch-target") &&
			(ctx.viewport === "mobile" || ctx.page.viewportSize.width < 768)
				? (ruleOptions<{ minPx: number }>(ctx, "a11y/touch-target").minPx ?? 44)
				: undefined,
	});
	setSnapshot(ctx, snapshot);
	result.ariaSnapshot = snapshot.aria;
	result.title = snapshot.title;
	result.metrics = {
		requestCount: snapshot.metrics?.requestCount,
		pageWeightKb: snapshot.metrics?.transferKb,
	};

	try {
		const head = await readHead(ctx);
		result.faviconHref = head.iconHref ?? "";
		result.hreflangs = head.hreflangs;
	} catch {
		// head extraction is best effort
	}

	for (const check of CHECKS) {
		if (ctx.signal?.aborted) break;
		const startedCheck = Date.now();
		ctx.onEvent?.({ type: "check:start", rule: check.id, route: ctx.route });
		let produced: Finding[] = [];
		try {
			produced = await check.run(ctx);
		} catch (err) {
			ctx.onEvent?.({
				type: "log",
				level: "warn",
				message: `${check.id} failed on ${ctx.route} (${ctx.viewport}): ${(err as Error).message}`,
			});
		}
		findings.push(...produced);
		ctx.onEvent?.({
			type: "check:end",
			rule: check.id,
			route: ctx.route,
			durationMs: Date.now() - startedCheck,
			findings: produced.length,
		});
	}

	if (opts.lighthouse && lighthouseWanted(ctx) && !ctx.signal?.aborted) {
		ctx.onEvent?.({ type: "check:start", rule: "perf/*", route: ctx.route });
		const startedLh = Date.now();
		const lh = await runLighthouse(ctx, { port: opts.cdpPort });
		findings.push(...lh.findings);
		result.metrics = { ...result.metrics, ...lh.metrics };
		ctx.onEvent?.({
			type: "check:end",
			rule: "perf/*",
			route: ctx.route,
			durationMs: Date.now() - startedLh,
			findings: lh.findings.length,
		});
	}

	if (opts.screenshot !== false) {
		try {
			result.screenshot = await ctx.page.screenshot({ fullPage: false });
		} catch (err) {
			ctx.onEvent?.({
				type: "log",
				level: "debug",
				message: `screenshot failed on ${ctx.route}: ${(err as Error).message}`,
			});
		}
	}

	// Drop undefined metric keys so the report validates against the schema.
	for (const key of Object.keys(result.metrics) as Array<keyof RouteMetrics>) {
		if (result.metrics[key] === undefined) delete result.metrics[key];
	}
	result.durationMs = Date.now() - started;
	return result;
}
