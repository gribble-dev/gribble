/**
 * perf/* — Lighthouse (performance category, desktop preset) over the session's CDP port.
 * Any failure yields no findings plus an `error` the caller records as a check that did not run;
 * the audit never crashes because of Lighthouse.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { routeSlug } from "../baseline/slug.js";
import type { Finding, RouteMetrics } from "../report/schema.js";
import { report, ruleEnabled, ruleOptions, truncate } from "./finding.js";
import type { CheckContext } from "./types.js";

export const PERF_RULES = [
	"perf/lighthouse-performance",
	"perf/lcp",
	"perf/cls",
	"perf/tbt",
	"perf/page-weight",
	"perf/unsized-images",
	"perf/image-format",
	"perf/render-blocking",
	"perf/regression",
] as const;

/** True when any Lighthouse-backed rule is on for the route. */
export function lighthouseWanted(ctx: Pick<CheckContext, "project" | "route">): boolean {
	return PERF_RULES.some((r) => ruleEnabled(ctx, r));
}

interface LhAudit {
	id: string;
	score: number | null;
	numericValue?: number;
	displayValue?: string;
	details?: { items?: Array<Record<string, unknown>>; type?: string };
}

interface LhResult {
	categories: Record<string, { score: number | null }>;
	audits: Record<string, LhAudit>;
	runtimeError?: { code: string; message: string };
	runWarnings?: string[];
}

export interface RunLighthouseOptions {
	/** Remote debugging port of the audited browser. */
	port?: number;
	timeoutMs?: number;
}

/** Extract Gribble metrics from a Lighthouse result. */
export function metricsFromLighthouse(lhr: LhResult): RouteMetrics {
	const metrics: RouteMetrics = {};
	const num = (id: string) => lhr.audits[id]?.numericValue;
	const lcp = num("largest-contentful-paint");
	if (lcp !== undefined) metrics.lcpMs = Math.round(lcp);
	const cls = num("cumulative-layout-shift");
	if (cls !== undefined) metrics.cls = Math.round(cls * 1000) / 1000;
	const tbt = num("total-blocking-time");
	if (tbt !== undefined) metrics.tbtMs = Math.round(tbt);
	const score = lhr.categories.performance?.score;
	if (typeof score === "number") metrics.lighthousePerformance = Math.round(score * 100);
	const weight = num("total-byte-weight");
	if (weight !== undefined) metrics.pageWeightKb = Math.round(weight / 1024);
	const requests = lhr.audits["network-requests"]?.details?.items;
	if (Array.isArray(requests)) metrics.requestCount = requests.length;
	return metrics;
}

export interface LighthouseResult {
	findings: Finding[];
	metrics: RouteMetrics;
	/** Set when Lighthouse did not produce a result; `findings` and `metrics` are then empty. */
	error?: string;
}

/** perf/lighthouse-performance, perf/lcp, perf/cls, perf/tbt, perf/page-weight, perf/unsized-images, perf/image-format, perf/render-blocking. */
export async function runLighthouse(
	ctx: CheckContext,
	opts: RunLighthouseOptions = {},
): Promise<LighthouseResult> {
	const findings: Finding[] = [];
	if (!lighthouseWanted(ctx)) return { findings, metrics: {} };
	const port = opts.port;
	if (!port) {
		return { findings, metrics: {}, error: "Lighthouse could not run: no CDP port for the browser session" };
	}
	const desktop = ctx.project.config.viewports.desktop ?? { width: 1366, height: 768 };
	let lhr: LhResult | undefined;
	try {
		const { default: lighthouse, desktopConfig } = await import("lighthouse");
		const result = await Promise.race([
			lighthouse(
				ctx.url,
				{
					port,
					logLevel: "silent",
					output: "json",
					onlyCategories: ["performance"],
					formFactor: "desktop",
					screenEmulation: {
						mobile: false,
						width: desktop.width,
						height: desktop.height,
						deviceScaleFactor: 1,
						disabled: false,
					},
					disableStorageReset: true,
					maxWaitForLoad: 45_000,
				},
				desktopConfig,
			),
			new Promise<undefined>((_, reject) =>
				setTimeout(() => reject(new Error("Lighthouse timed out")), opts.timeoutMs ?? 90_000).unref(),
			),
		]);
		lhr = result?.lhr as unknown as LhResult | undefined;
		if (lhr?.runtimeError) throw new Error(`${lhr.runtimeError.code}: ${lhr.runtimeError.message}`);
		if (result && ctx.runDir) {
			const dir = join(ctx.runDir, "lighthouse");
			await mkdir(dir, { recursive: true });
			const json = Array.isArray(result.report) ? result.report[0] : result.report;
			if (json) await writeFile(join(dir, `${routeSlug(ctx.route)}.json`), json, "utf8");
		}
	} catch (err) {
		return {
			findings,
			metrics: {},
			error: `Lighthouse could not run: ${truncate((err as Error).message, 200)}`,
		};
	}
	if (!lhr) return { findings, metrics: {}, error: "Lighthouse could not run: it returned no result" };

	const metrics = metricsFromLighthouse(lhr);
	const location = { path: "document" };

	if (ruleEnabled(ctx, "perf/lighthouse-performance") && metrics.lighthousePerformance !== undefined) {
		const min = ruleOptions<{ min: number }>(ctx, "perf/lighthouse-performance").min ?? 80;
		if (metrics.lighthousePerformance < min) {
			report(ctx, findings, "perf/lighthouse-performance", {
				title: `Lighthouse performance score is ${metrics.lighthousePerformance} (minimum ${min})`,
				message: `${ctx.route} scored ${metrics.lighthousePerformance}/100 on the desktop preset. LCP ${metrics.lcpMs ?? "?"} ms, CLS ${metrics.cls ?? "?"}, TBT ${metrics.tbtMs ?? "?"} ms.`,
				subject: "score",
				location,
				evidence: { data: metrics },
			});
		}
	}
	if (ruleEnabled(ctx, "perf/lcp") && metrics.lcpMs !== undefined) {
		const maxMs = ruleOptions<{ maxMs: number }>(ctx, "perf/lcp").maxMs ?? 2500;
		if (metrics.lcpMs > maxMs) {
			const element = lhr.audits["largest-contentful-paint-element"]?.details?.items?.[0] as
				| { items?: Array<{ node?: { selector?: string; snippet?: string } }> }
				| undefined;
			const node = element?.items?.[0]?.node;
			report(ctx, findings, "perf/lcp", {
				title: `LCP is ${metrics.lcpMs} ms (limit ${maxMs} ms)`,
				message: `Largest Contentful Paint on ${ctx.route} took ${metrics.lcpMs} ms${node?.selector ? `; LCP element: ${node.selector}` : ""}.`,
				subject: "lcp",
				location: node?.selector ? { selector: node.selector } : location,
				evidence: { snippet: node?.snippet, data: { lcpMs: metrics.lcpMs } },
			});
		}
	}
	if (ruleEnabled(ctx, "perf/cls") && metrics.cls !== undefined) {
		const max = ruleOptions<{ max: number }>(ctx, "perf/cls").max ?? 0.1;
		if (metrics.cls > max) {
			const shifts = lhr.audits["layout-shifts"]?.details?.items?.slice(0, 3) as
				| Array<{ node?: { selector?: string }; score?: number }>
				| undefined;
			report(ctx, findings, "perf/cls", {
				title: `CLS is ${metrics.cls} (limit ${max})`,
				message: `Cumulative Layout Shift on ${ctx.route} is ${metrics.cls}${shifts?.length ? `; largest shifts: ${shifts.map((s) => s.node?.selector ?? "unknown").join(", ")}` : ""}.`,
				subject: "cls",
				location: shifts?.[0]?.node?.selector ? { selector: shifts[0].node.selector } : location,
				evidence: { data: { cls: metrics.cls, shifts } },
			});
		}
	}
	if (ruleEnabled(ctx, "perf/tbt") && metrics.tbtMs !== undefined) {
		const maxMs = ruleOptions<{ maxMs: number }>(ctx, "perf/tbt").maxMs ?? 200;
		if (metrics.tbtMs > maxMs) {
			report(ctx, findings, "perf/tbt", {
				title: `TBT is ${metrics.tbtMs} ms (limit ${maxMs} ms)`,
				message: `Total Blocking Time on ${ctx.route} is ${metrics.tbtMs} ms.`,
				subject: "tbt",
				location,
				evidence: { data: { tbtMs: metrics.tbtMs } },
			});
		}
	}
	if (ruleEnabled(ctx, "perf/page-weight") && metrics.pageWeightKb !== undefined) {
		const maxKb = ruleOptions<{ maxKb: number }>(ctx, "perf/page-weight").maxKb ?? 2000;
		if (metrics.pageWeightKb > maxKb) {
			const heaviest = (lhr.audits["total-byte-weight"]?.details?.items?.slice(0, 3) ?? []) as Array<{
				url?: string;
				totalBytes?: number;
			}>;
			report(ctx, findings, "perf/page-weight", {
				title: `Page weight is ${metrics.pageWeightKb} KB (limit ${maxKb} KB)`,
				message: `${ctx.route} transfers ${metrics.pageWeightKb} KB${heaviest.length ? `; heaviest: ${heaviest.map((h) => `${truncate(h.url ?? "", 50)} (${Math.round((h.totalBytes ?? 0) / 1024)} KB)`).join(", ")}` : ""}.`,
				subject: "weight",
				location,
				evidence: { data: { pageWeightKb: metrics.pageWeightKb, heaviest } },
			});
		}
	}
	const itemAudits: Array<{ rule: string; audit: string; title: string }> = [
		{ rule: "perf/unsized-images", audit: "unsized-images", title: "Image without explicit dimensions" },
		{ rule: "perf/image-format", audit: "modern-image-formats", title: "Image could use a modern format" },
		{ rule: "perf/render-blocking", audit: "render-blocking-resources", title: "Render-blocking resource" },
	];
	for (const { rule, audit, title } of itemAudits) {
		if (!ruleEnabled(ctx, rule)) continue;
		const result = lhr.audits[audit];
		if (!result || result.score === null || result.score >= 1) continue;
		const items = (result.details?.items ?? []).slice(0, 10) as Array<{
			url?: string;
			node?: { selector?: string; snippet?: string };
			wastedBytes?: number;
			wastedMs?: number;
		}>;
		for (const item of items) {
			const url = item.url ?? item.node?.selector ?? audit;
			report(ctx, findings, rule, {
				title: `${title}: ${truncate(url, 70)}`,
				message: `${result.displayValue ? `${result.displayValue}. ` : ""}Lighthouse audit "${audit}" flags ${url}${item.wastedBytes ? ` (${Math.round(item.wastedBytes / 1024)} KB potential savings)` : ""}${item.wastedMs ? ` (${Math.round(item.wastedMs)} ms)` : ""}.`,
				subject: url.split("?")[0],
				location: item.node?.selector ? { selector: item.node.selector } : location,
				evidence: { url: item.url, snippet: item.node?.snippet },
			});
		}
	}
	return { findings, metrics };
}
