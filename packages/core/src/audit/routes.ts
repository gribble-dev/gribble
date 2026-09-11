/**
 * Turns `target.routes` (auto | crawl | list), discovered framework routes and the change set into
 * the concrete list of routes and URLs to audit.
 */
import type { BrowserSession } from "../browser/types.js";
import type { ProjectContext } from "../project/types.js";
import type { DiscoveredRoutes } from "../repo/routes.js";
import { normalizeRoute } from "../report/fingerprint.js";
import type { AuditEvent } from "./types.js";

export interface ResolveRoutesOptions {
	project: ProjectContext;
	browser: BrowserSession;
	discovered: DiscoveredRoutes;
	changedFiles?: string[];
	requested?: string[];
	onEvent?: (e: AuditEvent) => void;
	signal?: AbortSignal;
	/** Maximum pages visited while crawling. Default 50. */
	crawlLimit?: number;
}

export interface ResolvedRoutes {
	routes: string[];
	/** Route -> URL to load. */
	urls: Record<string, string>;
	/** Routes that could not be mapped to a URL (unresolved dynamic segments). */
	skipped: string[];
	/** True when the audit was narrowed to changed routes. */
	incremental: boolean;
}

function collectSameOriginLinks(): string[] {
	const out = new Set<string>();
	for (const a of Array.from(document.querySelectorAll("a[href]"))) {
		const href = (a as HTMLAnchorElement).href;
		if (!href || !/^https?:/i.test(href)) continue;
		try {
			const url = new URL(href);
			if (url.origin !== location.origin) continue;
			url.hash = "";
			out.add(url.toString());
		} catch {
			// ignore
		}
	}
	return [...out];
}

function urlFor(base: string, route: string): string {
	const origin = new URL(base);
	return `${origin.origin}${route.startsWith("/") ? route : `/${route}`}`;
}

function isDynamic(route: string): boolean {
	return route.includes("[");
}

/** Regex for a framework route pattern: `[param]` -> one segment, `[...rest]` -> the remainder. */
export function routePatternRegex(pattern: string): RegExp {
	const source = pattern
		.split("/")
		.map((seg) => {
			if (/^\[\.\.\..+\]$/.test(seg)) return ".+";
			if (/^\[.+\]$/.test(seg)) return "[^/]+";
			return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		})
		.join("/");
	return new RegExp(`^${source}/?$`, "i");
}

/** BFS crawl of same-origin links starting at `startUrls`. Returns normalized route -> URL. */
export async function crawlRoutes(
	browser: BrowserSession,
	startUrls: string[],
	opts: { limit: number; signal?: AbortSignal; onEvent?: (e: AuditEvent) => void },
): Promise<Map<string, string>> {
	const found = new Map<string, string>();
	const queue = [...startUrls];
	const visited = new Set<string>();
	const page = await browser.newPage();
	try {
		while (queue.length > 0 && visited.size < opts.limit) {
			if (opts.signal?.aborted) break;
			const url = queue.shift()!;
			const key = normalizeRoute(url);
			if (visited.has(url)) continue;
			visited.add(url);
			if (!found.has(key)) found.set(key, url);
			const nav = await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 20_000 });
			if (!nav.ok) {
				opts.onEvent?.({
					type: "log",
					level: "debug",
					message: `crawl: ${url} answered ${nav.status ?? nav.error}`,
				});
				continue;
			}
			const links = await page.raw.evaluate(collectSameOriginLinks).catch(() => [] as string[]);
			for (const link of links) {
				if (/\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|css|js|json|xml|txt|mp4|webm|woff2?)(\?|$)/i.test(link))
					continue;
				const linkKey = normalizeRoute(link);
				if (!found.has(linkKey) && !visited.has(link) && !queue.includes(link)) {
					queue.push(link);
				}
			}
		}
	} finally {
		await page.close().catch(() => {});
	}
	return found;
}

function narrowToChanged(
	routes: string[],
	discovered: DiscoveredRoutes,
	changedFiles: string[],
): { routes: string[]; incremental: boolean } {
	if (changedFiles.length === 0) return { routes, incremental: false };
	const changed = changedFiles.map((f) => f.replace(/\\/g, "/"));
	const dirs = routes
		.map((route) => {
			const source = discovered.source[route]?.replace(/\\/g, "/");
			if (!source) return undefined;
			return { route, source, dir: source.split("/").slice(0, -1).join("/") };
		})
		.filter((r): r is { route: string; source: string; dir: string } => !!r);
	const kept = new Set<string>();
	let unmatched = false;
	for (const file of changed) {
		// The most specific route directory containing the file wins (`app/` must not swallow `app/about/`).
		const best = dirs
			.filter(
				(d) => file === d.source || file.endsWith(`/${d.source}`) || (d.dir && file.includes(`${d.dir}/`)),
			)
			.sort((a, b) => b.dir.length - a.dir.length)[0];
		if (best) kept.add(best.route);
		else unmatched = true;
	}
	// A change outside any route directory (shared component, layout, config) touches everything.
	if (unmatched || kept.size === 0) return { routes, incremental: false };
	return { routes: routes.filter((r) => kept.has(r)), incremental: true };
}

/** Resolve the routes to audit and their URLs. */
export async function resolveRoutes(opts: ResolveRoutesOptions): Promise<ResolvedRoutes> {
	const { project, discovered } = opts;
	const base = project.config.target.url;
	const limit = opts.crawlLimit ?? 50;
	const urls: Record<string, string> = {};
	const skipped: string[] = [];
	let incremental = false;

	let candidates: string[];
	const configured = project.config.target.routes;
	if (opts.requested && opts.requested.length > 0) {
		candidates = opts.requested.map(normalizeRoute);
	} else if (Array.isArray(configured)) {
		candidates = configured.map(normalizeRoute);
	} else if (configured === "crawl" || discovered.routes.length === 0) {
		if (configured === "auto") {
			opts.onEvent?.({
				type: "log",
				level: "info",
				message: "No framework routes found; crawling links from the target URL instead.",
			});
		}
		const crawled = await crawlRoutes(opts.browser, [base], {
			limit,
			signal: opts.signal,
			onEvent: opts.onEvent,
		});
		const routes = [...crawled.keys()];
		for (const route of routes) urls[route] = crawled.get(route)!;
		return { routes, urls, skipped, incremental };
	} else {
		const narrowed = narrowToChanged(discovered.routes, discovered, opts.changedFiles ?? []);
		candidates = narrowed.routes.map(normalizeRoute);
		incremental = narrowed.incremental;
	}

	const unique = [...new Set(candidates)];
	const dynamic = unique.filter(isDynamic);
	for (const route of unique) {
		if (!isDynamic(route)) urls[route] = urlFor(base, route);
	}
	if (dynamic.length > 0) {
		const seeds = Object.values(urls).length > 0 ? Object.values(urls).slice(0, 10) : [base];
		const crawled = await crawlRoutes(opts.browser, seeds, {
			limit: Math.min(limit, 30),
			signal: opts.signal,
			onEvent: opts.onEvent,
		});
		const staticSet = new Set(unique.filter((r) => !isDynamic(r)));
		for (const pattern of dynamic) {
			const re = routePatternRegex(pattern);
			let match: string | undefined;
			for (const [route, url] of crawled) {
				if (staticSet.has(route)) continue;
				const path = new URL(url).pathname;
				if (re.test(path)) {
					match = url;
					break;
				}
			}
			if (match) urls[pattern] = match;
			else {
				skipped.push(pattern);
				opts.onEvent?.({
					type: "log",
					level: "info",
					message: `Skipping ${pattern}: no link on the crawled pages matches this dynamic route.`,
				});
			}
		}
	}
	const routes = unique.filter((r) => urls[r] !== undefined);
	return { routes, urls, skipped, incremental };
}
