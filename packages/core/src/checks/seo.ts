/**
 * seo/* per-route checks: head metadata, headings, canonical, robots, structured data, URL format.
 * Site-wide SEO rules (duplicate titles, robots.txt, sitemap) live in site-wide.ts.
 */
import type { Finding } from "../report/schema.js";
import { globMatch } from "../util/index.js";
import { report, ruleEnabled, ruleOptions, truncate } from "./finding.js";
import type { CheckContext } from "./types.js";

export interface HeadInfo {
	title: string;
	description: string | null;
	h1s: string[];
	headings: Array<{ level: number; text: string }>;
	canonical: string | null;
	robots: string | null;
	googlebot: string | null;
	lang: string | null;
	og: Record<string, string>;
	twitter: Record<string, string>;
	jsonLd: string[];
	iconHref: string | null;
	hreflangs: string[];
}

function collectHead(): HeadInfo {
	const meta = (selector: string): string | null =>
		document.querySelector(selector)?.getAttribute("content") ?? null;
	const og: Record<string, string> = {};
	for (const el of Array.from(document.querySelectorAll('meta[property^="og:"]'))) {
		og[el.getAttribute("property")!.slice(3)] = el.getAttribute("content") ?? "";
	}
	const twitter: Record<string, string> = {};
	for (const el of Array.from(document.querySelectorAll('meta[name^="twitter:"]'))) {
		twitter[el.getAttribute("name")!.slice(8)] = el.getAttribute("content") ?? "";
	}
	const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).map((h) => ({
		level: Number(h.tagName[1]),
		text: (h.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
	}));
	return {
		title: document.title ?? "",
		description: meta('meta[name="description"]'),
		h1s: headings.filter((h) => h.level === 1).map((h) => h.text),
		headings,
		canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
		robots: meta('meta[name="robots"]'),
		googlebot: meta('meta[name="googlebot"]'),
		lang: document.documentElement.getAttribute("lang"),
		og,
		twitter,
		jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(
			(s) => s.textContent ?? "",
		),
		iconHref:
			document
				.querySelector('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')
				?.getAttribute("href") ?? null,
		hreflangs: Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]')).map(
			(l) => l.getAttribute("hreflang") ?? "",
		),
	};
}

export async function readHead(ctx: CheckContext): Promise<HeadInfo> {
	const cached = (ctx.cache as { head?: HeadInfo } | undefined)?.head;
	if (cached) return cached;
	const head = await ctx.page.raw.evaluate(collectHead);
	if (!ctx.cache) ctx.cache = {};
	(ctx.cache as { head?: HeadInfo }).head = head;
	return head;
}

function pathOf(url: string): string | undefined {
	try {
		return new URL(url).pathname;
	} catch {
		return undefined;
	}
}

function stripSlash(path: string): string {
	return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** seo/title, meta-description, single-h1, heading-order, canonical, robots-noindex, lang-attribute, open-graph, twitter-card, structured-data, url-format. */
export async function checkSeo(ctx: CheckContext): Promise<Finding[]> {
	const out: Finding[] = [];
	const rules = [
		"seo/title",
		"seo/meta-description",
		"seo/single-h1",
		"seo/heading-order",
		"seo/canonical",
		"seo/robots-noindex",
		"seo/lang-attribute",
		"seo/open-graph",
		"seo/twitter-card",
		"seo/structured-data",
		"seo/url-format",
	];
	if (!rules.some((r) => ruleEnabled(ctx, r))) return out;
	const head = await readHead(ctx);
	const headLocation = { selector: "head" };

	if (ruleEnabled(ctx, "seo/title")) {
		const { min, max } = ruleOptions<{ min: number; max: number }>(ctx, "seo/title");
		const title = head.title.trim();
		if (!title) {
			report(ctx, out, "seo/title", {
				title: "Page has no <title>",
				message: `${ctx.route} renders without a document title.`,
				subject: "missing",
				location: headLocation,
			});
		} else if (title.length < min) {
			report(ctx, out, "seo/title", {
				title: `Title "${truncate(title, 40)}" is too short (${title.length} < ${min})`,
				message: `The title has ${title.length} characters; at least ${min} are expected.`,
				subject: "too-short",
				location: headLocation,
				evidence: { snippet: title },
			});
		} else if (title.length > max) {
			report(ctx, out, "seo/title", {
				title: `Title is too long (${title.length} > ${max})`,
				message: `"${truncate(title, 80)}" has ${title.length} characters; search results truncate after about ${max}.`,
				subject: "too-long",
				location: headLocation,
				evidence: { snippet: title },
			});
		}
	}

	if (ruleEnabled(ctx, "seo/meta-description")) {
		const { min, max } = ruleOptions<{ min: number; max: number }>(ctx, "seo/meta-description");
		const description = head.description?.trim();
		if (!description) {
			report(ctx, out, "seo/meta-description", {
				title: "Page has no meta description",
				message: `${ctx.route} has no <meta name="description">.`,
				subject: "missing",
				location: headLocation,
			});
		} else if (description.length < min) {
			report(ctx, out, "seo/meta-description", {
				title: `Meta description is too short (${description.length} < ${min})`,
				message: `"${truncate(description, 80)}" has ${description.length} characters.`,
				subject: "too-short",
				location: headLocation,
				evidence: { snippet: description },
			});
		} else if (description.length > max) {
			report(ctx, out, "seo/meta-description", {
				title: `Meta description is too long (${description.length} > ${max})`,
				message: `"${truncate(description, 80)}" has ${description.length} characters.`,
				subject: "too-long",
				location: headLocation,
				evidence: { snippet: description },
			});
		}
	}

	if (ruleEnabled(ctx, "seo/single-h1")) {
		if (head.h1s.length === 0) {
			report(ctx, out, "seo/single-h1", {
				title: "Page has no <h1>",
				message: `${ctx.route} renders no top-level heading.`,
				subject: "none",
				location: { selector: "body" },
			});
		} else if (head.h1s.length > 1) {
			report(ctx, out, "seo/single-h1", {
				title: `Page has ${head.h1s.length} <h1> elements`,
				message: `Found: ${head.h1s.map((h) => `"${truncate(h, 40)}"`).join(", ")}. Keep one <h1> per page.`,
				subject: "multiple",
				location: { selector: "h1" },
			});
		}
	}

	if (ruleEnabled(ctx, "seo/heading-order")) {
		let previous = 0;
		for (const h of head.headings) {
			if (previous > 0 && h.level > previous + 1) {
				report(ctx, out, "seo/heading-order", {
					title: `Heading level skips from h${previous} to h${h.level}`,
					message: `"${truncate(h.text, 60)}" is an <h${h.level}> directly after an <h${previous}>.`,
					subject: `h${previous}->h${h.level}:${truncate(h.text, 40)}`,
					location: { selector: `h${h.level}` },
				});
				break;
			}
			previous = h.level;
		}
	}

	if (ruleEnabled(ctx, "seo/canonical")) {
		const canonical = head.canonical?.trim();
		if (!canonical) {
			report(ctx, out, "seo/canonical", {
				title: "Page has no canonical link",
				message: `${ctx.route} has no <link rel="canonical">.`,
				subject: "missing",
				location: headLocation,
			});
		} else if (!/^https?:\/\//i.test(canonical)) {
			report(ctx, out, "seo/canonical", {
				title: `Canonical "${truncate(canonical, 50)}" is not an absolute URL`,
				message: `Canonical links must be absolute; got "${canonical}".`,
				subject: "relative",
				location: headLocation,
				evidence: { snippet: canonical },
			});
		} else {
			const canonicalPath = pathOf(canonical);
			const currentPath = pathOf(ctx.page.url()) ?? pathOf(ctx.url);
			if (canonicalPath === undefined) {
				report(ctx, out, "seo/canonical", {
					title: "Canonical URL is malformed",
					message: `"${canonical}" does not parse as a URL.`,
					subject: "malformed",
					location: headLocation,
				});
			} else if (
				currentPath &&
				stripSlash(canonicalPath).toLowerCase() !== stripSlash(currentPath).toLowerCase()
			) {
				report(ctx, out, "seo/canonical", {
					title: `Canonical points at ${truncate(canonicalPath, 50)} instead of ${truncate(currentPath, 50)}`,
					message: `${ctx.url} declares ${canonical} as canonical, which is a different route.`,
					subject: "mismatch",
					location: headLocation,
					evidence: { url: canonical },
				});
			}
		}
	}

	if (ruleEnabled(ctx, "seo/robots-noindex")) {
		const allow = ruleOptions<{ allow: string[] }>(ctx, "seo/robots-noindex").allow ?? [];
		if (!globMatch(ctx.route, allow)) {
			const header =
				ctx.cache?.navigation?.headers?.["x-robots-tag"] ??
				ctx.page.lastNavigation()?.headers?.["x-robots-tag"];
			const sources: string[] = [];
			if (/\bnoindex\b/i.test(head.robots ?? ""))
				sources.push(`<meta name="robots" content="${head.robots}">`);
			if (/\bnoindex\b/i.test(head.googlebot ?? ""))
				sources.push(`<meta name="googlebot" content="${head.googlebot}">`);
			if (/\bnoindex\b/i.test(header ?? "")) sources.push(`X-Robots-Tag: ${header}`);
			if (sources.length) {
				report(ctx, out, "seo/robots-noindex", {
					title: `${ctx.route} is marked noindex`,
					message: `Search engines are told not to index this route via ${sources.join(" and ")}. Add the route to \`allow\` if that is intended.`,
					subject: "noindex",
					location: headLocation,
					evidence: { snippet: sources.join("\n") },
				});
			}
		}
	}

	if (ruleEnabled(ctx, "seo/lang-attribute") && !head.lang?.trim()) {
		report(ctx, out, "seo/lang-attribute", {
			title: "<html> has no lang attribute",
			message: "Screen readers and search engines need the document language.",
			subject: "missing",
			location: { selector: "html" },
		});
	}

	if (ruleEnabled(ctx, "seo/open-graph")) {
		const missing = ["title", "description", "image"].filter((k) => !head.og[k]?.trim());
		if (missing.length) {
			report(ctx, out, "seo/open-graph", {
				title: `Missing Open Graph tags: ${missing.map((m) => `og:${m}`).join(", ")}`,
				message: `${ctx.route} lacks ${missing.map((m) => `og:${m}`).join(", ")}; link previews will be incomplete.`,
				subject: missing.join(","),
				location: headLocation,
			});
		}
	}

	if (ruleEnabled(ctx, "seo/twitter-card")) {
		const missing = ["card", "title", "description"].filter((k) => !head.twitter[k]?.trim());
		if (missing.length) {
			report(ctx, out, "seo/twitter-card", {
				title: `Missing Twitter card tags: ${missing.map((m) => `twitter:${m}`).join(", ")}`,
				message: `${ctx.route} lacks ${missing.map((m) => `twitter:${m}`).join(", ")}.`,
				subject: missing.join(","),
				location: headLocation,
			});
		}
	}

	if (ruleEnabled(ctx, "seo/structured-data")) {
		head.jsonLd.forEach((raw, index) => {
			const selector = `script[type="application/ld+json"]:nth-of-type(${index + 1})`;
			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch (err) {
				report(ctx, out, "seo/structured-data", {
					title: `JSON-LD block ${index + 1} is not valid JSON`,
					message: (err as Error).message,
					subject: `block-${index + 1}:invalid-json`,
					location: { selector },
					evidence: { snippet: raw.slice(0, 300) },
				});
				return;
			}
			const items = Array.isArray(parsed) ? parsed : [parsed];
			for (const item of items) {
				if (!item || typeof item !== "object") continue;
				const obj = item as Record<string, unknown>;
				const graph = Array.isArray(obj["@graph"]) ? (obj["@graph"] as Record<string, unknown>[]) : undefined;
				const context = String(obj["@context"] ?? "");
				if (!context) {
					report(ctx, out, "seo/structured-data", {
						title: `JSON-LD block ${index + 1} has no @context`,
						message: "Every JSON-LD block needs `@context: https://schema.org`.",
						subject: `block-${index + 1}:no-context`,
						location: { selector },
					});
				} else if (!/schema\.org/i.test(context)) {
					report(ctx, out, "seo/structured-data", {
						title: `JSON-LD block ${index + 1} uses an unknown @context`,
						message: `@context is "${context}"; expected https://schema.org.`,
						subject: `block-${index + 1}:context`,
						location: { selector },
					});
				}
				const targets = graph ?? [obj];
				for (const t of targets) {
					const type = t["@type"];
					const types = Array.isArray(type) ? type : type ? [type] : [];
					if (types.length === 0) {
						report(ctx, out, "seo/structured-data", {
							title: `JSON-LD block ${index + 1} has an item without @type`,
							message: "Each JSON-LD item needs a schema.org @type.",
							subject: `block-${index + 1}:no-type`,
							location: { selector },
						});
						break;
					}
					const bad = types.find((tp) => typeof tp !== "string" || !/^[A-Z][A-Za-z0-9]*$/.test(tp));
					if (bad !== undefined) {
						report(ctx, out, "seo/structured-data", {
							title: `JSON-LD block ${index + 1} declares an unknown type "${String(bad)}"`,
							message: "schema.org types are PascalCase identifiers such as Organization or Article.",
							subject: `block-${index + 1}:type:${String(bad)}`,
							location: { selector },
						});
						break;
					}
				}
			}
		});
	}

	if (ruleEnabled(ctx, "seo/url-format")) {
		const { lowercase, trailingSlash } = ruleOptions<{ lowercase: boolean; trailingSlash: string }>(
			ctx,
			"seo/url-format",
		);
		const path = pathOf(ctx.page.url()) ?? pathOf(ctx.url) ?? "/";
		if (lowercase && path !== path.toLowerCase()) {
			report(ctx, out, "seo/url-format", {
				title: `URL path ${truncate(path, 60)} contains uppercase characters`,
				message: `Serve ${path.toLowerCase()} and redirect the mixed-case form.`,
				subject: "uppercase",
				viewport: null,
			});
		}
		if (path !== "/" && trailingSlash === "never" && path.endsWith("/")) {
			report(ctx, out, "seo/url-format", {
				title: `URL ${truncate(path, 60)} has a trailing slash`,
				message: "The trailing-slash policy is `never`.",
				subject: "trailing-slash",
				viewport: null,
			});
		}
		if (path !== "/" && trailingSlash === "always" && !path.endsWith("/")) {
			report(ctx, out, "seo/url-format", {
				title: `URL ${truncate(path, 60)} lacks a trailing slash`,
				message: "The trailing-slash policy is `always`.",
				subject: "trailing-slash",
				viewport: null,
			});
		}
	}
	return out;
}
