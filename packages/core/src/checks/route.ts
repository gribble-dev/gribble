/**
 * Runs every enabled deterministic per-route check on one page/viewport.
 */
import { notRunEntry } from "../report/completeness.js";
import type { Finding, NotRunCheck, NotRunReasonCode, RouteMetrics } from "../report/schema.js";
import { checkA11y } from "./a11y.js";
import { runAxe } from "./axe.js";
import { ruleEnabled, ruleOptions } from "./finding.js";
import { checkHtml } from "./html.js";
import { checkI18n } from "./i18n.js";
import { lighthouseWanted, runLighthouse } from "./lighthouse.js";
import { checkLinks } from "./links.js";
import { checkNetwork } from "./network.js";
import { documentMediaType, isHtmlMediaType, setSnapshot } from "./page-data.js";
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

type Check = {
	id: string;
	run: (ctx: CheckContext) => Promise<Finding[]>;
	/**
	 * True for rule families that judge an HTML document (doctype, headings, anchors, layout,
	 * copy, accessibility tree). They are skipped when the response is not HTML: a sitemap,
	 * a feed or a JSON endpoint has no title, viewport meta or h1 to miss.
	 */
	htmlOnly: boolean;
};

const CHECKS: Check[] = [
	// Status, failed requests and console output describe the response, whatever its type.
	{ id: "network/*", run: checkNetwork, htmlOnly: false },
	{ id: "html/*", run: checkHtml, htmlOnly: true },
	{ id: "seo/*", run: checkSeo, htmlOnly: true },
	// Anchors, images, scripts and stylesheets are collected from the DOM, so there is nothing
	// to probe on a non-HTML response.
	{ id: "links/*", run: checkLinks, htmlOnly: true },
	{ id: "ui/*", run: checkUi, htmlOnly: true },
	{ id: "i18n/*", run: checkI18n, htmlOnly: true },
	// Transport, response headers and leaked credentials apply to any response.
	{ id: "security/*", run: checkSecurity, htmlOnly: false },
	{ id: "a11y/*", run: runAxe, htmlOnly: true },
	// Focus, keyboard and motion rules that axe does not cover; they move focus and emulate media,
	// so they run last.
	{ id: "a11y/*", run: checkA11y, htmlOnly: true },
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
	const spacing =
		ruleEnabled(ctx, "ui/spacing-from-tokens") && ctx.tokens && ctx.tokens.spacing.size > 0
			? [...ctx.tokens.spacing]
			: undefined;
	return colors || fontSizes || spacing ? { colors, fontSizes, spacing } : undefined;
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

	const notRun: NotRunCheck[] = [];
	const result: RouteCheckResult = {
		findings,
		metrics: {},
		ariaSnapshot: "",
		status: nav?.status,
		finalUrl: nav?.finalUrl,
		notRun,
	};

	if (!loaded) {
		result.unreachable = nav?.error ?? (nav?.status !== undefined ? `HTTP ${nav.status}` : "no response");
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

	// A non-HTML document (sitemap, feed, JSON) cannot fail html/*, seo/*, a11y/* and friends
	// honestly, so those families are recorded as not run instead of producing false positives.
	// A missing content-type header is treated as HTML (see isHtmlMediaType).
	const mediaType = documentMediaType(ctx);
	const html = isHtmlMediaType(mediaType);
	const skipReason = html ? undefined : `response is ${mediaType}, not an HTML document; page rules skipped`;
	if (skipReason) {
		const skipped = CHECKS.filter((c) => c.htmlOnly).map((c) => c.id);
		ctx.onEvent?.({
			type: "log",
			level: "info",
			message: `${ctx.route} is ${mediaType}; ${skipped.join(", ")} skipped.`,
		});
	}

	const skip = (rule: string, code: NotRunReasonCode, reason: string, startedCheck: number) => {
		notRun.push(notRunEntry(rule, code, reason, ctx.route));
		ctx.onEvent?.({
			type: "check:end",
			rule,
			route: ctx.route,
			durationMs: Date.now() - startedCheck,
			findings: 0,
			ok: false,
			error: reason,
		});
	};

	for (const check of CHECKS) {
		if (ctx.signal?.aborted) break;
		const startedCheck = Date.now();
		ctx.onEvent?.({ type: "check:start", rule: check.id, route: ctx.route });
		if (skipReason && check.htmlOnly) {
			skip(check.id, "unsupported", skipReason, startedCheck);
			continue;
		}
		let produced: Finding[];
		try {
			produced = await check.run(ctx);
		} catch (err) {
			skip(check.id, "error", `failed on ${ctx.viewport}: ${(err as Error).message}`, startedCheck);
			continue;
		}
		findings.push(...produced);
		ctx.onEvent?.({
			type: "check:end",
			rule: check.id,
			route: ctx.route,
			durationMs: Date.now() - startedCheck,
			findings: produced.length,
			ok: true,
		});
	}

	if (opts.lighthouse && lighthouseWanted(ctx) && !ctx.signal?.aborted) {
		ctx.onEvent?.({ type: "check:start", rule: "perf/*", route: ctx.route });
		const startedLh = Date.now();
		if (skipReason) {
			// Lighthouse scores a page load; a sitemap has no LCP worth gating on.
			skip("perf/*", "unsupported", skipReason, startedLh);
		} else {
			const lh = await runLighthouse(ctx, { port: opts.cdpPort });
			findings.push(...lh.findings);
			result.metrics = { ...result.metrics, ...lh.metrics };
			if (lh.error) {
				skip("perf/*", "error", lh.error, startedLh);
			} else {
				ctx.onEvent?.({
					type: "check:end",
					rule: "perf/*",
					route: ctx.route,
					durationMs: Date.now() - startedLh,
					findings: lh.findings.length,
					ok: true,
				});
			}
		}
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
