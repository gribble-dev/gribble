/**
 * ui/* and the layout-derived a11y/touch-target — placeholder copy, broken images, favicon,
 * overlap, horizontal overflow, clipped text, font sizes, design-token deviations and empty lists.
 */
import type { Finding } from "../report/schema.js";
import { compilePatterns, report, ruleEnabled, ruleOptions, truncate } from "./finding.js";
import { getSnapshot, sameOrigin, targetOrigin } from "./page-data.js";
import type { CheckContext } from "./types.js";

interface TextHit {
	pattern: string;
	snippet: string;
	selector: string;
}

/** Search visible text nodes for the given regex sources; first hit per pattern. Runs in the page. */
function findTextMatches(sources: Array<{ source: string; flags: string }>): TextHit[] {
	const hits: TextHit[] = [];
	const regexes = sources.map((s) => ({ re: new RegExp(s.source, s.flags), key: s.source }));
	const found = new Set<string>();
	const selectorFor = (el: Element): string => {
		const testId = el.getAttribute("data-testid");
		if (testId) return `[data-testid="${testId}"]`;
		const id = el.getAttribute("id");
		if (id) return `#${CSS.escape(id)}`;
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
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	let node = walker.nextNode();
	while (node && found.size < regexes.length) {
		const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
		const parent = node.parentElement;
		if (text && parent && !["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(parent.tagName)) {
			const style = window.getComputedStyle(parent);
			if (style.display !== "none" && style.visibility !== "hidden") {
				for (const { re, key } of regexes) {
					if (found.has(key)) continue;
					re.lastIndex = 0;
					if (re.test(text)) {
						found.add(key);
						hits.push({ pattern: key, snippet: text.slice(0, 160), selector: selectorFor(parent) });
					}
				}
			}
		}
		node = walker.nextNode();
	}
	return hits;
}

interface BrokenImage {
	src: string;
	alt: string;
	selector: string;
}

function findBrokenImages(): BrokenImage[] {
	const out: BrokenImage[] = [];
	for (const img of Array.from(document.images)) {
		if (!img.getAttribute("src")) continue;
		if (!img.complete) continue; // still loading (lazy) — not a verdict
		if (img.naturalWidth === 0 && img.naturalHeight === 0) {
			const testId = img.getAttribute("data-testid");
			const id = img.getAttribute("id");
			out.push({
				src: img.currentSrc || img.src,
				alt: img.getAttribute("alt") ?? "",
				selector: testId
					? `[data-testid="${testId}"]`
					: id
						? `#${CSS.escape(id)}`
						: `img[src="${img.getAttribute("src")}"]`,
			});
		}
	}
	return out;
}

interface EmptyContainer {
	tag: string;
	role: string;
	label: string;
	selector: string;
}

/**
 * Lists, tables and grids that render no items and carry no explanatory text inside or next to
 * them. Anything hidden, loading, navigational or ambiguous is left alone. Runs in the page.
 */
function findEmptyContainers(input: { limit: number }): EmptyContainer[] {
	const selectorFor = (el: Element): string => {
		const testId = el.getAttribute("data-testid");
		if (testId) return `[data-testid="${testId}"]`;
		const id = el.getAttribute("id");
		if (id) return `#${CSS.escape(id)}`;
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
	const isRendered = (el: Element): boolean => {
		const rect = el.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return false;
		const check = (el as Element & { checkVisibility?: (options?: unknown) => boolean }).checkVisibility;
		if (typeof check === "function") {
			return check.call(el, { contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true });
		}
		const style = getComputedStyle(el);
		return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
	};
	/**
	 * Visible text under `root`, skipping `except`, headings and header cells: a heading or a column
	 * header names the list, it does not explain its emptiness.
	 */
	const visibleText = (root: Element, except?: Element): string => {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let out = "";
		let node = walker.nextNode();
		while (node) {
			const parent = node.parentElement;
			const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
			if (
				text &&
				parent &&
				!except?.contains(parent) &&
				!parent.closest(
					'script, style, template, noscript, h1, h2, h3, h4, h5, h6, thead, th, caption, [role="columnheader"], [role="rowheader"]',
				) &&
				isRendered(parent)
			) {
				out += `${text} `;
			}
			node = walker.nextNode();
		}
		return out.trim();
	};
	const labelOf = (el: Element): string => {
		const labelledBy = el.getAttribute("aria-labelledby");
		const byId = labelledBy ? document.getElementById(labelledBy)?.textContent : undefined;
		const caption = el.querySelector(":scope > caption")?.textContent;
		return (el.getAttribute("aria-label") || byId || caption || "").replace(/\s+/g, " ").trim().slice(0, 60);
	};
	const itemsOf = (el: Element, tag: string, role: string): number => {
		if (tag === "table") {
			return Array.from(el.querySelectorAll("tr")).filter((tr) => !tr.closest("thead, tfoot")).length;
		}
		if (role === "grid" || role === "table") {
			// Header rows hold column headers only; a data row has at least one cell.
			return Array.from(el.querySelectorAll('[role="row"]')).filter((row) =>
				row.querySelector('[role="gridcell"], [role="cell"], td'),
			).length;
		}
		if (role === "list") return el.querySelectorAll('[role="listitem"], li').length;
		return Array.from(el.children).filter((c) => c.tagName.toLowerCase() === "li").length;
	};

	const out: EmptyContainer[] = [];
	const candidates = document.querySelectorAll('table, ul, ol, [role="list"], [role="grid"], [role="table"]');
	for (const el of Array.from(candidates)) {
		if (out.length >= input.limit) break;
		const tag = el.tagName.toLowerCase();
		const role = el.getAttribute("role") ?? "";
		if ((tag === "ul" || tag === "ol") && role && role !== "list") continue;
		if (
			el.closest(
				'nav, header, footer, [role="navigation"], [role="menu"], [role="menubar"], [role="tablist"], [aria-hidden="true"], [aria-busy="true"], template, [inert]',
			)
		)
			continue;
		if (!isRendered(el)) continue;
		if (itemsOf(el, tag, role) > 0) continue;
		// Text inside the container is its own empty state; text next to it (a sibling paragraph)
		// counts as explanation too, headings excluded.
		if (visibleText(el)) continue;
		const parent = el.parentElement;
		if (parent && parent !== document.body && visibleText(parent, el)) continue;
		out.push({ tag, role, label: labelOf(el), selector: selectorFor(el) });
	}
	return out;
}

/** ui/placeholder-text, ui/broken-images, ui/favicon, ui/overlap, ui/horizontal-overflow, ui/text-clipped, ui/min-font-size, ui/*-from-tokens, ui/empty-state, a11y/touch-target. */
export async function checkUi(ctx: CheckContext): Promise<Finding[]> {
	const out: Finding[] = [];
	const rules = [
		"ui/placeholder-text",
		"ui/broken-images",
		"ui/favicon",
		"ui/overlap",
		"ui/horizontal-overflow",
		"ui/text-clipped",
		"ui/min-font-size",
		"ui/colors-from-tokens",
		"ui/font-sizes-from-tokens",
		"ui/spacing-from-tokens",
		"ui/empty-state",
		"a11y/touch-target",
	];
	if (!rules.some((r) => ruleEnabled(ctx, r))) return out;

	if (ruleEnabled(ctx, "ui/empty-state")) {
		const empty = await ctx.page.raw
			.evaluate(findEmptyContainers, { limit: 10 })
			.catch(() => [] as EmptyContainer[]);
		for (const container of empty) {
			const what = container.role ? `<${container.tag} role="${container.role}">` : `<${container.tag}>`;
			const named = container.label ? `${what} "${truncate(container.label, 40)}"` : what;
			const noun =
				container.tag === "table" || container.role === "grid" || container.role === "table"
					? "rows"
					: "items";
			report(ctx, out, "ui/empty-state", {
				title: `${named} renders zero ${noun} and no empty state`,
				message: `${named} on ${ctx.route} is visible, contains no ${noun}, and neither it nor its parent shows any text explaining why.`,
				subject: container.selector,
				location: { selector: container.selector },
			});
		}
	}

	if (ruleEnabled(ctx, "ui/placeholder-text")) {
		const patterns = compilePatterns(
			ruleOptions<{ patterns: string[] }>(ctx, "ui/placeholder-text").patterns ?? [],
			{ word: true },
		);
		if (patterns.length) {
			const hits = await ctx.page.raw
				.evaluate(
					findTextMatches,
					patterns.map((re) => ({ source: re.source, flags: re.flags })),
				)
				.catch(() => [] as TextHit[]);
			for (const hit of hits) {
				const label = patterns.find((re) => re.source === hit.pattern);
				const shown = label ? label.source.replace(/\\b/g, "").replace(/\\/g, "") : hit.pattern;
				report(ctx, out, "ui/placeholder-text", {
					title: `Placeholder copy "${truncate(shown, 30)}" is visible`,
					message: `Text on ${ctx.route} matches the placeholder pattern "${shown}": "${truncate(hit.snippet, 100)}".`,
					subject: shown,
					location: { selector: hit.selector },
					evidence: { snippet: hit.snippet },
				});
			}
		}
	}

	if (ruleEnabled(ctx, "ui/broken-images")) {
		const broken = await ctx.page.raw.evaluate(findBrokenImages).catch(() => [] as BrokenImage[]);
		const seen = new Set<string>();
		for (const img of broken) {
			const key = img.src.split("?")[0]!;
			if (seen.has(key)) continue;
			seen.add(key);
			report(ctx, out, "ui/broken-images", {
				title: `Image ${truncate(key, 70)} does not render`,
				message: `<img src="${img.src}"${img.alt ? ` alt="${img.alt}"` : ""}> loaded with a natural size of 0×0.`,
				subject: key,
				location: { selector: img.selector },
				evidence: { url: img.src },
			});
		}
	}

	if (ruleEnabled(ctx, "ui/favicon") && ctx.shared && !ctx.shared.reportedOnce.has("ui/favicon")) {
		ctx.shared.reportedOnce.add("ui/favicon");
		const iconHref = await ctx.page.raw
			.evaluate(
				() =>
					document.querySelector('link[rel~="icon"], link[rel="shortcut icon"]')?.getAttribute("href") ??
					null,
			)
			.catch(() => null);
		const origin = targetOrigin(ctx);
		const candidates = [
			iconHref ? new URL(iconHref, ctx.page.url()).toString() : undefined,
			`${origin}/favicon.ico`,
		].filter((u): u is string => !!u);
		let found = false;
		for (const url of candidates) {
			if (!sameOrigin(url, origin)) {
				found = true; // external icon host: trust it
				break;
			}
			const probe = await ctx.shared.links.probe(url);
			if (probe.ok) {
				found = true;
				break;
			}
		}
		if (!found) {
			report(ctx, out, "ui/favicon", {
				title: "Site has no favicon",
				message: iconHref
					? `The icon link ${iconHref} does not resolve, and /favicon.ico is missing.`
					: 'No <link rel="icon"> is declared and /favicon.ico is missing.',
				subject: "missing",
				location: { selector: "head" },
				viewport: null,
			});
		}
	}

	const needsLayout = [
		"ui/overlap",
		"ui/horizontal-overflow",
		"ui/text-clipped",
		"ui/min-font-size",
		"ui/colors-from-tokens",
		"ui/font-sizes-from-tokens",
		"ui/spacing-from-tokens",
		"a11y/touch-target",
	].some((r) => ruleEnabled(ctx, r));
	if (!needsLayout) return out;
	const snapshot = await getSnapshot(ctx);

	if (ruleEnabled(ctx, "ui/overlap")) {
		for (const issue of snapshot.layout.filter((l) => l.kind === "overlap").slice(0, 10)) {
			const selectors = issue.selectors ?? [];
			report(ctx, out, "ui/overlap", {
				title: `Interactive elements overlap: ${truncate(issue.detail, 90)}`,
				message: `${issue.detail} (viewport ${ctx.viewport}, ${ctx.page.viewportSize.width}×${ctx.page.viewportSize.height}).`,
				subject: selectors.join(" + "),
				location: { selector: selectors[0] },
				evidence: { data: { refs: issue.refs, selectors } },
			});
		}
	}

	if (ruleEnabled(ctx, "ui/horizontal-overflow")) {
		const viewports = ruleOptions<{ viewports: string[] }>(ctx, "ui/horizontal-overflow").viewports ?? [
			"mobile",
		];
		if (viewports.includes(ctx.viewport)) {
			const overflow = snapshot.layout.find((l) => l.kind === "overflow-x");
			if (overflow) {
				report(ctx, out, "ui/horizontal-overflow", {
					title: `Page scrolls horizontally in the ${ctx.viewport} viewport`,
					message: `${overflow.detail} (${ctx.page.viewportSize.width}×${ctx.page.viewportSize.height}).`,
					subject: "overflow-x",
					location: { selector: overflow.selectors?.[0] },
					evidence: { data: { selectors: overflow.selectors } },
				});
			}
		}
	}

	if (ruleEnabled(ctx, "ui/text-clipped")) {
		for (const issue of snapshot.layout.filter((l) => l.kind === "text-clipped").slice(0, 10)) {
			report(ctx, out, "ui/text-clipped", {
				title: `Text is clipped: ${truncate(issue.detail, 80)}`,
				message: `${issue.detail} (viewport ${ctx.viewport}).`,
				subject: issue.selectors?.[0] ?? issue.detail,
				location: { selector: issue.selectors?.[0] },
			});
		}
	}

	if (ruleEnabled(ctx, "a11y/touch-target")) {
		for (const issue of snapshot.layout.filter((l) => l.kind === "small-touch-target").slice(0, 15)) {
			report(ctx, out, "a11y/touch-target", {
				title: `Touch target too small: ${truncate(issue.detail, 80)}`,
				message: `${issue.detail} in the ${ctx.viewport} viewport.`,
				subject: issue.selectors?.[0] ?? issue.refs[0] ?? "",
				location: { selector: issue.selectors?.[0] },
			});
		}
	}

	if (ruleEnabled(ctx, "ui/min-font-size")) {
		const seen = new Set<string>();
		for (const v of snapshot.styles.filter((s) => s.kind === "min-font-size")) {
			if (seen.has(v.selector) || seen.size >= 10) continue;
			seen.add(v.selector);
			report(ctx, out, "ui/min-font-size", {
				title: `Text "${truncate(v.text ?? v.selector, 40)}" is ${v.value}`,
				message: `Computed font-size is ${v.value}; the minimum is ${v.expected}.`,
				subject: v.selector,
				location: { selector: v.selector },
				evidence: { snippet: v.text },
			});
		}
	}

	if (ruleEnabled(ctx, "ui/colors-from-tokens")) {
		for (const v of snapshot.styles.filter((s) => s.kind === "color").slice(0, 15)) {
			report(ctx, out, "ui/colors-from-tokens", {
				title: `${v.property} ${v.value} is not a design token`,
				message: `"${truncate(v.text ?? v.selector, 40)}" renders with ${v.property}: ${v.value}, which is not in the project's color tokens.`,
				subject: `${v.property}:${v.value}`,
				location: { selector: v.selector },
				evidence: { snippet: v.text },
			});
		}
	}

	if (ruleEnabled(ctx, "ui/font-sizes-from-tokens")) {
		for (const v of snapshot.styles.filter((s) => s.kind === "font-size").slice(0, 15)) {
			report(ctx, out, "ui/font-sizes-from-tokens", {
				title: `font-size ${v.value} is not in the type scale`,
				message: `"${truncate(v.text ?? v.selector, 40)}" renders at ${v.value}, which is not one of the project's font-size tokens.`,
				subject: `font-size:${v.value}`,
				location: { selector: v.selector },
				evidence: { snippet: v.text },
			});
		}
	}

	if (ruleEnabled(ctx, "ui/spacing-from-tokens")) {
		for (const v of snapshot.styles.filter((s) => s.kind === "spacing").slice(0, 15)) {
			report(ctx, out, "ui/spacing-from-tokens", {
				title: `${v.property} ${v.value} is not a spacing token`,
				message: `"${truncate(v.text ?? v.selector, 40)}" renders with ${v.property}: ${v.value}, which is not in the project's spacing tokens.`,
				subject: `${v.property}:${v.value}`,
				location: { selector: v.selector },
				evidence: { snippet: v.text },
			});
		}
	}
	return out;
}
