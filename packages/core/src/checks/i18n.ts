/**
 * i18n/untranslated-keys — raw translation keys such as `home.hero.title` leaking into visible text.
 */
import type { Finding } from "../report/schema.js";
import { report, ruleEnabled, ruleOptions, truncate } from "./finding.js";
import type { CheckContext } from "./types.js";

interface KeyHit {
	key: string;
	selector: string;
}

function findKeys(input: { sources: string[]; limit: number }): KeyHit[] {
	const { sources, limit } = input;
	const regexes = sources.map((s) => new RegExp(s));
	const hits: KeyHit[] = [];
	const seen = new Set<string>();
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
	const consider = (text: string, el: Element) => {
		const trimmed = text.replace(/\s+/g, " ").trim();
		if (!trimmed || trimmed.length > 120 || seen.has(trimmed)) return;
		if (regexes.some((re) => re.test(trimmed))) {
			seen.add(trimmed);
			hits.push({ key: trimmed, selector: selectorFor(el) });
		}
	};
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	let node = walker.nextNode();
	while (node && hits.length < limit) {
		const parent = node.parentElement;
		if (parent && !["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(parent.tagName)) {
			const style = window.getComputedStyle(parent);
			if (style.display !== "none" && style.visibility !== "hidden") consider(node.textContent ?? "", parent);
		}
		node = walker.nextNode();
	}
	for (const el of Array.from(document.querySelectorAll("[placeholder], [title], [aria-label], [alt]"))) {
		if (hits.length >= limit) break;
		for (const attr of ["placeholder", "title", "aria-label", "alt"]) {
			const value = el.getAttribute(attr);
			if (value) consider(value, el);
		}
	}
	return hits;
}

/** i18n/untranslated-keys. */
export async function checkI18n(ctx: CheckContext): Promise<Finding[]> {
	const out: Finding[] = [];
	if (!ruleEnabled(ctx, "i18n/untranslated-keys")) return out;
	const patterns = (ruleOptions<{ patterns: string[] }>(ctx, "i18n/untranslated-keys").patterns ?? []).filter(
		(p) => {
			try {
				new RegExp(p);
				return true;
			} catch {
				return false;
			}
		},
	);
	if (patterns.length === 0) return out;
	const hits = await ctx.page.raw
		.evaluate(findKeys, { sources: patterns, limit: 20 })
		.catch(() => [] as KeyHit[]);
	for (const hit of hits) {
		report(ctx, out, "i18n/untranslated-keys", {
			title: `Translation key "${truncate(hit.key, 50)}" is visible`,
			message: `The text "${hit.key}" on ${ctx.route} looks like an untranslated message key.`,
			subject: hit.key,
			location: { selector: hit.selector },
			evidence: { snippet: hit.key },
		});
	}
	return out;
}
