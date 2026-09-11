/**
 * network/* — page status, failed requests, console output and request budgets.
 */
import type { Finding } from "../report/schema.js";
import { compilePatterns, report, ruleEnabled, ruleOptions, truncate } from "./finding.js";
import type { CheckContext } from "./types.js";

/** Collapse numbers, hashes and URLs so repeated messages share a fingerprint. */
export function normalizeConsoleText(text: string): string {
	return text
		.replace(/https?:\/\/[^\s)]+/g, "<url>")
		.replace(/\b[0-9a-f]{8,}\b/gi, "<hash>")
		.replace(/\d+/g, "#")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 200);
}

const BENIGN_FAILURES = /^net::ERR_ABORTED$/;

/** network/page-error, network/failed-requests, network/console-errors, network/console-warnings, network/large-assets, network/request-count. */
export async function checkNetwork(ctx: CheckContext): Promise<Finding[]> {
	const out: Finding[] = [];
	const nav = ctx.cache?.navigation ?? ctx.page.lastNavigation();

	if (ruleEnabled(ctx, "network/page-error") && nav && (!nav.ok || (nav.status ?? 0) >= 400)) {
		report(ctx, out, "network/page-error", {
			title: `Route ${ctx.route} does not load (${nav.status ? `HTTP ${nav.status}` : (nav.error ?? "no response")})`,
			message: `${ctx.url} answered ${nav.status ? `HTTP ${nav.status}` : `with an error: ${nav.error ?? "unknown"}`}.`,
			subject: ctx.url,
			evidence: { url: ctx.url, data: { status: nav.status, error: nav.error, finalUrl: nav.finalUrl } },
		});
	}

	const failed = ctx.page.drainFailedRequests();
	if (ruleEnabled(ctx, "network/failed-requests")) {
		const seen = new Set<string>();
		for (const f of failed) {
			if (f.url === ctx.url || f.url === nav?.finalUrl) continue; // reported as page-error
			if (f.failure && BENIGN_FAILURES.test(f.failure)) continue;
			if (/^(data|blob):/.test(f.url)) continue;
			const key = f.url.split("?")[0]!;
			if (seen.has(key)) continue;
			seen.add(key);
			const why = f.status ? `HTTP ${f.status}` : (f.failure ?? "failed");
			report(ctx, out, "network/failed-requests", {
				title: `${f.resourceType ?? "request"} ${truncate(key, 70)} failed (${why})`,
				message: `${f.method} ${f.url} ${f.status ? `returned HTTP ${f.status}` : `failed: ${f.failure ?? "unknown error"}`} while loading ${ctx.route}.`,
				subject: key,
				evidence: {
					url: f.url,
					data: { status: f.status, failure: f.failure, resourceType: f.resourceType },
				},
			});
		}
	}

	const console = ctx.page.drainConsole();
	for (const [rule, level] of [
		["network/console-errors", "error"],
		["network/console-warnings", "warning"],
	] as const) {
		if (!ruleEnabled(ctx, rule)) continue;
		const ignore = compilePatterns(ruleOptions<{ ignore?: string[] }>(ctx, rule).ignore ?? []);
		const seen = new Set<string>();
		for (const entry of console) {
			if (entry.level !== level) continue;
			// Resource failures are reported by network/failed-requests with the URL; the console line adds nothing.
			if (level === "error" && /^Failed to load resource/.test(entry.text)) continue;
			if (ignore.some((re) => re.test(entry.text))) continue;
			const key = normalizeConsoleText(entry.text);
			if (!key || seen.has(key)) continue;
			seen.add(key);
			report(ctx, out, rule, {
				title: `Console ${level}: ${truncate(entry.text, 90)}`,
				message: `${entry.text.slice(0, 1000)}${entry.url ? `\nSource: ${entry.url}` : ""}`,
				subject: key,
				evidence: { snippet: entry.text.slice(0, 1000), url: entry.url },
			});
		}
	}

	const requests = ctx.page.requests();
	if (ruleEnabled(ctx, "network/large-assets")) {
		const maxKb = ruleOptions<{ maxKb: number }>(ctx, "network/large-assets").maxKb ?? 500;
		for (const r of requests) {
			if (!r.bytes || r.bytes <= maxKb * 1024) continue;
			const key = r.url.split("?")[0]!;
			report(ctx, out, "network/large-assets", {
				title: `${r.resourceType ?? "asset"} ${truncate(key, 70)} is ${Math.round(r.bytes / 1024)} KB`,
				message: `${r.url} transferred ${Math.round(r.bytes / 1024)} KB; the limit is ${maxKb} KB per asset.`,
				subject: key,
				evidence: { url: r.url, data: { bytes: r.bytes } },
			});
		}
	}
	if (ruleEnabled(ctx, "network/request-count")) {
		const max = ruleOptions<{ max: number }>(ctx, "network/request-count").max ?? 100;
		if (requests.length > max) {
			report(ctx, out, "network/request-count", {
				title: `${ctx.route} issues ${requests.length} requests on load`,
				message: `${requests.length} requests were made while loading ${ctx.url}; the limit is ${max}.`,
				subject: "request-count",
				evidence: { data: { count: requests.length, max } },
			});
		}
	}
	return out;
}
