/**
 * links/* — anchors and same-origin asset references are probed over HTTP with a per-run cache.
 */
import { locationFor, mapDomToSource } from "../repo/source-map.js";
import type { Finding } from "../report/schema.js";
import { matchOrigin } from "../util/index.js";
import { report, ruleEnabled, ruleOptions, truncate } from "./finding.js";
import { LinkCache, type LinkProbe } from "./link-cache.js";
import { sameOrigin, targetOrigin } from "./page-data.js";
import type { CheckContext } from "./types.js";

interface PageLink {
	href: string;
	kind: "anchor" | "img" | "script" | "stylesheet";
	text: string;
	selector: string;
	target?: string;
	rel?: string;
	testId?: string;
	id?: string;
	rawHref: string | null;
}

function collectLinks(refAttr: string): PageLink[] {
	const out: PageLink[] = [];
	const selectorFor = (el: Element): string => {
		const testId = el.getAttribute("data-testid");
		if (testId) return `[data-testid="${testId}"]`;
		const id = el.getAttribute("id");
		if (id && document.querySelectorAll(`#${CSS.escape(id)}`).length === 1) return `#${CSS.escape(id)}`;
		const ref = el.getAttribute(refAttr);
		if (ref) return `[${refAttr}="${ref}"]`;
		const parts: string[] = [];
		let node: Element | null = el;
		while (node && node.tagName.toLowerCase() !== "body" && parts.length < 6) {
			const parent: Element | null = node.parentElement;
			if (!parent) break;
			const same = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
			parts.unshift(
				same.length > 1
					? `${node.tagName.toLowerCase()}:nth-of-type(${same.indexOf(node) + 1})`
					: node.tagName.toLowerCase(),
			);
			node = parent;
		}
		return parts.join(" > ");
	};
	for (const a of Array.from(document.querySelectorAll("a"))) {
		const raw = a.getAttribute("href");
		out.push({
			href: a.href,
			rawHref: raw,
			kind: "anchor",
			text: (a.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
			selector: selectorFor(a),
			target: a.getAttribute("target") ?? undefined,
			rel: a.getAttribute("rel") ?? undefined,
			testId: a.getAttribute("data-testid") ?? undefined,
			id: a.getAttribute("id") ?? undefined,
		});
	}
	for (const img of Array.from(document.querySelectorAll("img[src]"))) {
		out.push({
			href: (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src,
			rawHref: img.getAttribute("src"),
			kind: "img",
			text: img.getAttribute("alt") ?? "",
			selector: selectorFor(img),
		});
	}
	for (const s of Array.from(document.querySelectorAll("script[src]"))) {
		out.push({
			href: (s as HTMLScriptElement).src,
			rawHref: s.getAttribute("src"),
			kind: "script",
			text: "",
			selector: selectorFor(s),
		});
	}
	for (const l of Array.from(document.querySelectorAll('link[rel~="stylesheet"][href]'))) {
		out.push({
			href: (l as HTMLLinkElement).href,
			rawHref: l.getAttribute("href"),
			kind: "stylesheet",
			text: "",
			selector: selectorFor(l),
		});
	}
	return out;
}

const SKIP_SCHEMES = /^(mailto|tel|sms|javascript|data|blob|about|file):/i;

function describe(probe: LinkProbe): string {
	if (probe.error) return probe.error;
	return `HTTP ${probe.status}`;
}

async function sourceLocation(ctx: CheckContext, link: PageLink) {
	if (!link.testId && !link.id && !link.text) return locationFor(undefined, { selector: link.selector });
	try {
		const matches = await mapDomToSource({
			targetDir: ctx.project.targetDir,
			testId: link.testId,
			id: link.id,
			text: link.text || undefined,
			route: ctx.route,
			routeSource: ctx.routeSource,
		});
		return locationFor(matches[0], { selector: link.selector });
	} catch {
		return locationFor(undefined, { selector: link.selector });
	}
}

/** links/broken, links/broken-external, links/redirect-chain, links/empty-href, links/target-blank-noopener. */
export async function checkLinks(ctx: CheckContext): Promise<Finding[]> {
	const out: Finding[] = [];
	const rules = [
		"links/broken",
		"links/broken-external",
		"links/redirect-chain",
		"links/empty-href",
		"links/target-blank-noopener",
	];
	if (!rules.some((r) => ruleEnabled(ctx, r))) return out;

	const links = await ctx.page.raw.evaluate(collectLinks, "data-gribble-ref").catch(() => [] as PageLink[]);
	const origin = targetOrigin(ctx);
	const externalOn = ruleEnabled(ctx, "links/broken-external");
	const externalOptions = ruleOptions<{ timeout: number; ignore: string[] }>(ctx, "links/broken-external");
	const redirectOptions = ruleOptions<{ max: number }>(ctx, "links/redirect-chain");
	const cache = ctx.shared?.links ?? new LinkCache();

	// Static anchor checks.
	for (const link of links) {
		if (link.kind !== "anchor") continue;
		const raw = (link.rawHref ?? "").trim();
		if (ruleEnabled(ctx, "links/empty-href")) {
			const empty =
				link.rawHref === null ? link.text.length > 0 : raw === "" || raw === "#" || /^javascript:/i.test(raw);
			if (empty) {
				report(ctx, out, "links/empty-href", {
					title: `Anchor "${truncate(link.text || "(no text)", 40)}" has no destination`,
					message: `href is ${link.rawHref === null ? "missing" : `"${raw}"`}. Anchors without a real URL break middle-click, "open in new tab" and keyboard semantics.`,
					subject: raw || "(missing)",
					location: await sourceLocation(ctx, link),
					evidence: { snippet: `<a href=${JSON.stringify(raw)}>${link.text}</a>` },
				});
			}
		}
		if (ruleEnabled(ctx, "links/target-blank-noopener") && link.target === "_blank") {
			const rel = (link.rel ?? "").toLowerCase().split(/\s+/);
			if (!rel.includes("noopener") && !rel.includes("noreferrer")) {
				report(ctx, out, "links/target-blank-noopener", {
					title: `target="_blank" link to ${truncate(link.href, 60)} lacks rel="noopener"`,
					message: `The anchor "${truncate(link.text || link.href, 40)}" opens a new tab without rel="noopener", which hands the opener window to the target page.`,
					subject: link.href,
					location: await sourceLocation(ctx, link),
				});
			}
		}
	}

	// HTTP probes. Subresources the browser already failed to load are reported by network/failed-requests.
	const browserFailed = new Set(
		ctx.page
			.requests()
			.filter((r) => (r.status ?? 0) >= 400)
			.map((r) => r.url.split("?")[0]),
	);
	const seen = new Set<string>();
	const probes: Array<{ link: PageLink; internal: boolean; promise: Promise<LinkProbe> }> = [];
	for (const link of links) {
		if (!link.href || SKIP_SCHEMES.test(link.href) || !/^https?:/i.test(link.href)) continue;
		const withoutHash = link.href.split("#")[0]!;
		if (!withoutHash || seen.has(withoutHash)) continue;
		if (link.kind !== "anchor" && browserFailed.has(withoutHash.split("?")[0])) continue;
		const internal = sameOrigin(withoutHash, origin);
		if (internal && !ruleEnabled(ctx, "links/broken") && !ruleEnabled(ctx, "links/redirect-chain")) continue;
		if (!internal) {
			if (!externalOn || link.kind !== "anchor") continue;
			const host = new URL(withoutHash).hostname;
			if (matchOrigin(host, externalOptions.ignore ?? [])) continue;
		}
		if (withoutHash === ctx.url.split("#")[0]) continue;
		seen.add(withoutHash);
		probes.push({
			link,
			internal,
			promise: cache.probe(withoutHash, {
				timeoutMs: internal ? 10_000 : (externalOptions.timeout ?? 10_000),
			}),
		});
	}
	for (const { link, internal, promise } of probes) {
		if (ctx.signal?.aborted) break;
		const probe = await promise;
		const rule = internal ? "links/broken" : "links/broken-external";
		const kindLabel =
			link.kind === "anchor"
				? "Link"
				: link.kind === "img"
					? "Image"
					: link.kind === "script"
						? "Script"
						: "Stylesheet";
		const inconclusive = !internal && (probe.status === 403 || probe.status === 429 || probe.status === 999);
		if (!probe.ok && !inconclusive && ruleEnabled(ctx, rule)) {
			report(ctx, out, rule, {
				title: `${kindLabel} to ${truncate(probe.url, 70)} is broken (${describe(probe)})`,
				message: `${link.kind === "anchor" ? `Anchor "${truncate(link.text || "(no text)", 40)}"` : `${kindLabel} reference`} points at ${probe.url}, which answered ${describe(probe)}${probe.redirects ? ` after ${probe.redirects} redirect(s)` : ""}.`,
				subject: probe.url,
				location: await sourceLocation(ctx, link),
				evidence: {
					url: probe.url,
					data: { status: probe.status, error: probe.error, finalUrl: probe.finalUrl },
				},
			});
		}
		if (
			internal &&
			probe.redirects > (redirectOptions.max ?? 1) &&
			ruleEnabled(ctx, "links/redirect-chain")
		) {
			report(ctx, out, "links/redirect-chain", {
				title: `${truncate(probe.url, 60)} redirects ${probe.redirects} times`,
				message: `${probe.url} reaches ${probe.finalUrl} after ${probe.redirects} redirects; the limit is ${redirectOptions.max}.`,
				subject: probe.url,
				location: await sourceLocation(ctx, link),
				suggestion: `Link directly to ${probe.finalUrl}.`,
				evidence: { url: probe.finalUrl, data: { redirects: probe.redirects } },
			});
		}
	}
	return out;
}
