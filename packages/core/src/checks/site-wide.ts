/**
 * Site-wide checks that need every route's result: duplicate titles, robots.txt, sitemap.xml,
 * trailing-slash consistency, hreflang reciprocity.
 */

import { normalizeRoute } from "../report/fingerprint.js";
import type { Finding } from "../report/schema.js";
import { makeFinding, ruleOptions, truncate } from "./finding.js";
import { LinkCache } from "./link-cache.js";
import type { SiteWideOptions } from "./types.js";

interface SiteContext {
	project: SiteWideOptions["project"];
	route: string;
	targetName: string;
	viewport: string;
	onEvent?: SiteWideOptions["onEvent"];
}

function emit(
	ctx: SiteContext,
	out: Finding[],
	rule: string,
	input: Parameters<typeof makeFinding>[2],
): void {
	const finding = makeFinding(ctx, rule, { ...input, viewport: null });
	if (!finding) return;
	out.push(finding);
	ctx.onEvent?.({ type: "finding", finding });
}

/** Parse robots.txt into directives; returns undefined when the body has no recognizable directive. */
export function parseRobots(
	text: string,
): { directives: number; disallowAll: boolean; sitemaps: string[] } | undefined {
	let directives = 0;
	let disallowAll = false;
	const sitemaps: string[] = [];
	let agentIsAll = false;
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.replace(/#.*$/, "").trim();
		if (!line) continue;
		const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
		if (!m) continue;
		const key = m[1]!.toLowerCase();
		const value = m[2]!.trim();
		if (!["user-agent", "disallow", "allow", "sitemap", "crawl-delay", "host"].includes(key)) continue;
		directives += 1;
		if (key === "user-agent") agentIsAll = value === "*";
		if (key === "disallow" && value === "/" && agentIsAll) disallowAll = true;
		if (key === "sitemap" && value) sitemaps.push(value);
	}
	return directives > 0 ? { directives, disallowAll, sitemaps } : undefined;
}

/** Extract `<loc>` paths from a sitemap or sitemap index. */
export function parseSitemapLocs(xml: string): {
	kind: "urlset" | "sitemapindex" | "unknown";
	locs: string[];
} {
	const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!.trim());
	const kind = /<sitemapindex[\s>]/i.test(xml)
		? "sitemapindex"
		: /<urlset[\s>]/i.test(xml)
			? "urlset"
			: "unknown";
	return { kind, locs };
}

/** seo/duplicate-title, seo/robots-txt, seo/sitemap, seo/url-format (consistent), seo/hreflang. */
export async function checkSiteWide(opts: SiteWideOptions): Promise<Finding[]> {
	const out: Finding[] = [];
	const { project, perRoute, targetName } = opts;
	const links = opts.shared?.links ?? new LinkCache();
	const origin = new URL(project.config.target.url).origin;
	const site: SiteContext = { project, route: "/", targetName, viewport: "", onEvent: opts.onEvent };

	// seo/duplicate-title
	if (project.rules.get("seo/duplicate-title").severity !== "off") {
		const byTitle = new Map<string, string[]>();
		for (const [route, result] of perRoute) {
			const title = result.title?.trim();
			if (!title) continue;
			byTitle.set(title, [...(byTitle.get(title) ?? []), route]);
		}
		for (const [title, routes] of byTitle) {
			if (routes.length < 2) continue;
			for (const route of routes) {
				emit({ ...site, route }, out, "seo/duplicate-title", {
					title: `Title "${truncate(title, 50)}" is shared with ${routes.length - 1} other route(s)`,
					message: `Routes with the same <title>: ${routes.join(", ")}.`,
					subject: title,
					location: { selector: "head > title" },
				});
			}
		}
	}

	// seo/robots-txt
	let robotsSitemaps: string[] = [];
	if (project.rules.get("seo/robots-txt").severity !== "off") {
		const probe = await links.probe(`${origin}/robots.txt`, { wantBody: true });
		if (!probe.ok) {
			emit(site, out, "seo/robots-txt", {
				title: "robots.txt is missing",
				message: `${origin}/robots.txt answered ${probe.status ? `HTTP ${probe.status}` : (probe.error ?? "nothing")}.`,
				subject: "missing",
				evidence: { url: probe.url },
			});
		} else {
			const parsed = parseRobots(probe.body ?? "");
			const contentType = probe.headers?.["content-type"] ?? "";
			if (!parsed || /text\/html/i.test(contentType)) {
				emit(site, out, "seo/robots-txt", {
					title: "robots.txt does not parse",
					message: `${origin}/robots.txt exists but contains no robots directives${/text\/html/i.test(contentType) ? " (it is served as HTML)" : ""}.`,
					subject: "invalid",
					evidence: { url: probe.url, snippet: (probe.body ?? "").slice(0, 200) },
				});
			} else {
				robotsSitemaps = parsed.sitemaps;
				if (parsed.disallowAll) {
					emit(site, out, "seo/robots-txt", {
						title: "robots.txt disallows the whole site",
						message:
							"`User-agent: *` with `Disallow: /` blocks every crawler. Remove it unless the site must stay private.",
						subject: "disallow-all",
						evidence: { url: probe.url },
					});
				}
			}
		}
	}

	// seo/sitemap
	if (project.rules.get("seo/sitemap").severity !== "off") {
		const candidates = [
			...new Set([...robotsSitemaps, `${origin}/sitemap.xml`, `${origin}/sitemap-index.xml`]),
		];
		let found: { url: string; locs: string[] } | undefined;
		let lastProbe: Awaited<ReturnType<typeof links.probe>> | undefined;
		for (const url of candidates) {
			const probe = await links.probe(url, { wantBody: true });
			lastProbe = probe;
			if (!probe.ok) continue;
			const parsed = parseSitemapLocs(probe.body ?? "");
			if (parsed.kind === "unknown") {
				emit(site, out, "seo/sitemap", {
					title: "sitemap.xml is not a valid sitemap",
					message: `${url} exists but has no <urlset> or <sitemapindex> root.`,
					subject: "invalid",
					evidence: { url },
				});
				found = { url, locs: [] };
				break;
			}
			let locs = parsed.locs;
			if (parsed.kind === "sitemapindex") {
				locs = [];
				for (const child of parsed.locs.slice(0, 20)) {
					const childProbe = await links.probe(child, { wantBody: true });
					if (childProbe.ok) locs.push(...parseSitemapLocs(childProbe.body ?? "").locs);
				}
			}
			found = { url, locs };
			break;
		}
		if (!found) {
			emit(site, out, "seo/sitemap", {
				title: "sitemap.xml is missing",
				message: `No sitemap at ${candidates.join(", ")}${lastProbe?.status ? ` (last answer HTTP ${lastProbe.status})` : ""}.`,
				subject: "missing",
			});
		} else if (found.locs.length > 0) {
			const covered = new Set(found.locs.map((l) => normalizeRoute(l)));
			const missing = opts.routes.filter((r) => !r.includes("[") && !covered.has(normalizeRoute(r)));
			if (missing.length > 0) {
				emit(site, out, "seo/sitemap", {
					title: `${missing.length} route(s) missing from the sitemap`,
					message: `${found.url} does not list: ${missing.slice(0, 15).join(", ")}${missing.length > 15 ? ", …" : ""}.`,
					subject: `missing:${missing.slice(0, 15).sort().join(",")}`,
					evidence: { url: found.url, data: { missing } },
				});
			}
		}
	}

	// seo/url-format: consistent trailing slash across the final URLs
	if (project.rules.get("seo/url-format").severity !== "off") {
		const { trailingSlash } = ruleOptions<{ trailingSlash: string }>(
			{ project, route: "/" },
			"seo/url-format",
		);
		if (trailingSlash === "consistent") {
			const withSlash: string[] = [];
			const without: string[] = [];
			for (const [route, result] of perRoute) {
				const path = (() => {
					try {
						return new URL(result.finalUrl ?? "").pathname;
					} catch {
						return undefined;
					}
				})();
				if (!path || path === "/") continue;
				(path.endsWith("/") ? withSlash : without).push(route);
			}
			if (withSlash.length > 0 && without.length > 0) {
				const minority = withSlash.length <= without.length ? withSlash : without;
				for (const route of minority) {
					emit({ ...site, route }, out, "seo/url-format", {
						title: `Trailing slash is inconsistent: ${route}`,
						message: `${withSlash.length} route(s) end with a slash and ${without.length} do not. Pick one form and redirect the other.`,
						subject: "trailing-slash-inconsistent",
					});
				}
			}
		}
	}

	// seo/hreflang: pages that declare alternates must include x-default and their own language.
	if (project.rules.get("seo/hreflang").severity !== "off") {
		for (const [route, result] of perRoute) {
			const langs = result.hreflangs ?? [];
			if (langs.length === 0) continue;
			if (!langs.some((l) => l.toLowerCase() === "x-default")) {
				emit({ ...site, route }, out, "seo/hreflang", {
					title: `${route} declares hreflang alternates without x-default`,
					message: `Alternates: ${langs.join(", ")}. Add <link rel="alternate" hreflang="x-default">.`,
					subject: "x-default",
					location: { selector: "head" },
				});
			}
		}
	}
	return out;
}
