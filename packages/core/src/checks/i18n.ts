/**
 * i18n/* — raw translation keys leaking into visible text, pages mixing scripts, and a declared
 * `lang` that disagrees with the URL or with the script the text is written in.
 *
 * Language detection here is deliberately coarse: text is classified by Unicode script family
 * (Latin, Cyrillic, CJK, ...), which is deterministic and cheap. Two languages that share a script
 * (English inside German) are invisible to it, and the descriptions in the registry say so.
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
	// File names, hostnames and package names look exactly like dotted message keys.
	const knownSuffix =
		/\.(md|mdx|txt|ya?ml|json|jsonc|toml|ini|env|lock|js|mjs|cjs|ts|mts|cts|tsx|jsx|css|scss|less|html?|svg|png|jpe?g|gif|webp|avif|ico|pdf|zip|tar|gz|xml|csv|sh|py|rb|go|rs|java|kt|swift|php|sql|log|map|wasm|com|org|net|io|dev|app|ai|co|me|sh|xyz|info|edu|gov|uk|de|fr|jp|cn|local|test|internal|localhost)$/i;
	const codeLike = new Set(["CODE", "PRE", "KBD", "SAMP", "VAR", "TT"]);
	const consider = (text: string, el: Element) => {
		const trimmed = text.replace(/\s+/g, " ").trim();
		if (!trimmed || trimmed.length > 120 || seen.has(trimmed)) return;
		if (knownSuffix.test(trimmed)) return;
		if (el.closest("code, pre, kbd, samp, var, tt")) return;
		if (regexes.some((re) => re.test(trimmed))) {
			seen.add(trimmed);
			hits.push({ key: trimmed, selector: selectorFor(el) });
		}
	};
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	let node = walker.nextNode();
	while (node && hits.length < limit) {
		const parent = node.parentElement;
		if (
			parent &&
			!["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(parent.tagName) &&
			!codeLike.has(parent.tagName)
		) {
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

type ScriptFamily = "latin" | "cyrillic" | "greek" | "cjk" | "arabic" | "hebrew" | "thai" | "indic" | "other";

/** Letters per script family in one `lang` context (the `<html>` element or a subtree with its own `lang`). */
interface LangContext {
	lang: string;
	isRoot: boolean;
	selector: string;
	letters: Partial<Record<ScriptFamily, number>>;
	samples: Partial<Record<ScriptFamily, string[]>>;
}

interface TextCensus {
	htmlLang: string;
	contexts: LangContext[];
}

/**
 * Count the letters of every substantial visible text node by script family, grouped by the
 * nearest `lang` attribute. Short strings (under 20 letters), code, hidden text and `translate="no"`
 * content are skipped; a node whose own letters are split between families is skipped too, because a
 * brand name inside a sentence should not count against the sentence. Runs in the page.
 */
function collectTextCensus(input: { minLetters: number }): TextCensus {
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
		return parts.join(" > ") || el.tagName.toLowerCase();
	};
	const FAMILIES: Array<[ScriptFamily, RegExp]> = [
		["latin", /\p{Script=Latin}/u],
		["cyrillic", /\p{Script=Cyrillic}/u],
		["greek", /\p{Script=Greek}/u],
		["cjk", /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u],
		["arabic", /\p{Script=Arabic}/u],
		["hebrew", /\p{Script=Hebrew}/u],
		["thai", /\p{Script=Thai}/u],
		[
			"indic",
			/[\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}]/u,
		],
	];
	const familyOf = (ch: string): ScriptFamily => {
		for (const [family, re] of FAMILIES) if (re.test(ch)) return family;
		return "other";
	};
	const contexts = new Map<Element, LangContext>();
	const root = document.documentElement;
	const contextFor = (el: Element): LangContext => {
		const owner = el.closest("[lang]") ?? root;
		let ctx = contexts.get(owner);
		if (!ctx) {
			ctx = {
				lang: (owner.getAttribute("lang") ?? "").trim().toLowerCase(),
				isRoot: owner === root,
				selector: owner === root ? "html" : selectorFor(owner),
				letters: {},
				samples: {},
			};
			contexts.set(owner, ctx);
		}
		return ctx;
	};
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	let node = walker.nextNode();
	while (node) {
		const parent = node.parentElement;
		const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
		node = walker.nextNode();
		if (!parent || !text) continue;
		if (
			parent.closest(
				'script, style, noscript, template, code, pre, kbd, samp, var, svg, math, [translate="no"], .notranslate',
			)
		) {
			continue;
		}
		const style = getComputedStyle(parent);
		if (style.display === "none" || style.visibility === "hidden") continue;
		const counts: Partial<Record<ScriptFamily, number>> = {};
		let total = 0;
		for (const ch of text) {
			if (!/\p{L}/u.test(ch)) continue;
			const family = familyOf(ch);
			counts[family] = (counts[family] ?? 0) + 1;
			total += 1;
		}
		if (total < input.minLetters) continue;
		let dominant: ScriptFamily = "other";
		let max = 0;
		for (const [family, count] of Object.entries(counts) as Array<[ScriptFamily, number]>) {
			if (count > max) {
				max = count;
				dominant = family;
			}
		}
		if (dominant === "other" || max / total < 0.6) continue;
		const ctx = contextFor(parent);
		ctx.letters[dominant] = (ctx.letters[dominant] ?? 0) + total;
		const samples = ctx.samples[dominant] ?? [];
		if (samples.length < 2) samples.push(text.slice(0, 80));
		ctx.samples[dominant] = samples;
	}
	return {
		htmlLang: (root.getAttribute("lang") ?? "").trim().toLowerCase(),
		contexts: [...contexts.values()],
	};
}

/** Script family a language is normally written in; missing means unknown, and unknown stays quiet. */
const LANGUAGE_FAMILY: Record<string, ScriptFamily> = Object.fromEntries([
	...[
		"en",
		"de",
		"fr",
		"es",
		"it",
		"pt",
		"nl",
		"sv",
		"da",
		"no",
		"nb",
		"nn",
		"fi",
		"is",
		"pl",
		"cs",
		"sk",
		"sl",
		"hr",
		"bs",
		"hu",
		"ro",
		"tr",
		"et",
		"lv",
		"lt",
		"id",
		"ms",
		"tl",
		"vi",
		"sw",
		"af",
		"ca",
		"eu",
		"gl",
		"cy",
		"ga",
		"mt",
		"sq",
		"eo",
		"la",
		"lb",
		"fo",
		"fy",
		"rm",
		"ht",
		"jv",
		"su",
		"uz",
		"az",
		"tk",
		"so",
		"ha",
		"yo",
		"ig",
		"zu",
		"xh",
		"st",
		"tn",
		"mg",
		"qu",
		"gn",
		"wa",
		"oc",
		"co",
		"sc",
		"an",
		"br",
	].map((l) => [l, "latin"] as const),
	...["ru", "uk", "be", "bg", "mk", "kk", "ky", "mn", "tg", "ba", "tt", "cv", "os", "ce"].map(
		(l) => [l, "cyrillic"] as const,
	),
	["el", "greek"] as const,
	...["zh", "ja", "ko", "yue", "wuu"].map((l) => [l, "cjk"] as const),
	...["ar", "fa", "ur", "ps", "sd", "ug", "ckb"].map((l) => [l, "arabic"] as const),
	...["he", "yi"].map((l) => [l, "hebrew"] as const),
	["th", "thai"] as const,
	...["hi", "mr", "ne", "sa", "bn", "pa", "gu", "or", "ta", "te", "kn", "ml", "si", "as", "mai", "bho"].map(
		(l) => [l, "indic"] as const,
	),
]);

const FAMILY_NAMES: Record<ScriptFamily, string> = {
	latin: "Latin",
	cyrillic: "Cyrillic",
	greek: "Greek",
	cjk: "CJK (Han, kana, Hangul)",
	arabic: "Arabic",
	hebrew: "Hebrew",
	thai: "Thai",
	indic: "Indic",
	other: "other",
};

/** Two-letter ISO 639-1 codes; a URL segment outside this set is not a locale. */
const ISO_639_1 = new Set(
	"aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu".split(
		" ",
	),
);

/**
 * Bare codes that double as English words or common URL segments (`/it/` for IT, `/id/123`,
 * `/my/account`, `/to/`, `/is/`). With a region subtag (`/it-IT/`) they are unambiguous.
 */
const AMBIGUOUS_BARE = new Set([
	"an",
	"as",
	"am",
	"be",
	"id",
	"ie",
	"io",
	"is",
	"it",
	"my",
	"no",
	"or",
	"so",
	"st",
	"to",
]);

interface Locale {
	segment: string;
	language: string;
	region?: string;
}

/** The locale segment leading a path, e.g. `de` in `/de/about` or `zh-CN` in `/zh-CN/`. */
export function routeLocale(pathname: string): Locale | undefined {
	const segment = pathname.split("/").filter(Boolean)[0];
	if (!segment) return undefined;
	const m = /^([a-z]{2})(?:[-_]([a-z]{2}|[0-9]{3}|[a-z]{4}))?$/i.exec(segment);
	if (!m) return undefined;
	const language = m[1]!.toLowerCase();
	const region = m[2]?.toLowerCase();
	if (!ISO_639_1.has(language)) return undefined;
	if (!region && AMBIGUOUS_BARE.has(language)) return undefined;
	return { segment, language, region };
}

function parseLang(lang: string): Locale | undefined {
	const m = /^([a-z]{2,3})(?:-([a-z]{2}|[0-9]{3}|[a-z]{4}))?/i.exec(lang.trim());
	if (!m) return undefined;
	return { segment: lang, language: m[1]!.toLowerCase(), region: m[2]?.toLowerCase() };
}

function dominantOf(
	context: LangContext,
): { family: ScriptFamily; share: number; total: number } | undefined {
	let total = 0;
	let best: ScriptFamily | undefined;
	let max = 0;
	for (const [family, count] of Object.entries(context.letters) as Array<[ScriptFamily, number]>) {
		total += count;
		if (count > max) {
			max = count;
			best = family;
		}
	}
	if (!best || total === 0) return undefined;
	return { family: best, share: max / total, total };
}

/** Letters of visible text a node needs to take part in the census. */
const MIN_NODE_LETTERS = 20;
/** Letters a page needs before its script mix says anything. */
const MIN_PAGE_LETTERS = 100;
/** Share and floor for a second script to count as mixing. */
const MIXED_SHARE = 0.2;
const MIXED_MIN_LETTERS = 40;
/** Letters and share for a context to be "written in" one script. */
const MISMATCH_MIN_LETTERS = 40;
const MISMATCH_SHARE = 0.8;

/** i18n/untranslated-keys, i18n/mixed-language, i18n/lang-mismatch. */
export async function checkI18n(ctx: CheckContext): Promise<Finding[]> {
	const out: Finding[] = [];
	const rules = ["i18n/untranslated-keys", "i18n/mixed-language", "i18n/lang-mismatch"];
	if (!rules.some((r) => ruleEnabled(ctx, r))) return out;

	if (ruleEnabled(ctx, "i18n/untranslated-keys")) {
		const patterns = (
			ruleOptions<{ patterns: string[] }>(ctx, "i18n/untranslated-keys").patterns ?? []
		).filter((p) => {
			try {
				new RegExp(p);
				return true;
			} catch {
				return false;
			}
		});
		if (patterns.length > 0) {
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
		}
	}

	const wantMixed = ruleEnabled(ctx, "i18n/mixed-language");
	const wantMismatch = ruleEnabled(ctx, "i18n/lang-mismatch");
	if (!wantMixed && !wantMismatch) return out;

	const census = await ctx.page.raw
		.evaluate(collectTextCensus, { minLetters: MIN_NODE_LETTERS })
		.catch((): TextCensus => ({ htmlLang: "", contexts: [] }));
	const rootContext = census.contexts.find((c) => c.isRoot);
	const declared = parseLang(census.htmlLang);
	const expected = declared ? LANGUAGE_FAMILY[declared.language] : undefined;

	if (wantMixed && rootContext) {
		const entries = (Object.entries(rootContext.letters) as Array<[ScriptFamily, number]>)
			.filter(([family]) => family !== "other")
			.sort((a, b) => b[1] - a[1]);
		const total = entries.reduce((sum, [, n]) => sum + n, 0);
		const second = entries[1];
		if (
			total >= MIN_PAGE_LETTERS &&
			second &&
			second[1] >= MIXED_MIN_LETTERS &&
			second[1] / total >= MIXED_SHARE
		) {
			const [first] = entries;
			// Name the script that does not belong: the one the declared lang is not written in.
			const foreign =
				expected && first![0] === expected ? second : expected && second[0] === expected ? first! : second;
			const share = Math.round((foreign[1] / total) * 100);
			const samples = rootContext.samples[foreign[0]] ?? [];
			report(ctx, out, "i18n/mixed-language", {
				title: `Page mixes ${FAMILY_NAMES[first![0]]} and ${FAMILY_NAMES[second[0]]} text`,
				message: `${share}% of the visible letters on ${ctx.route} are ${FAMILY_NAMES[foreign[0]]} script${
					census.htmlLang ? ` while <html lang="${census.htmlLang}"> is declared` : ""
				}${samples.length ? `, for example "${truncate(samples[0]!, 60)}"` : ""}.`,
				subject: `${first![0]}+${second[0]}`,
				location: { selector: "html" },
				evidence: { snippet: samples.join(" | ") || undefined, data: { letters: rootContext.letters } },
			});
		}
	}

	if (wantMismatch) {
		let pathname = "";
		try {
			pathname = new URL(ctx.url).pathname;
		} catch {
			pathname = ctx.route;
		}
		const locale = routeLocale(pathname);
		if (locale && declared) {
			const languageDiffers = locale.language !== declared.language;
			const regionDiffers = !!locale.region && !!declared.region && locale.region !== declared.region;
			if (languageDiffers || regionDiffers) {
				report(ctx, out, "i18n/lang-mismatch", {
					title: `URL locale /${locale.segment}/ disagrees with lang="${census.htmlLang}"`,
					message: `The route ${ctx.route} starts with the locale segment /${locale.segment}/, but the document declares <html lang="${census.htmlLang}">.`,
					subject: `route:${locale.segment}`,
					location: { selector: "html" },
					suggestion: `Set lang="${locale.segment}" on <html>, or fix the URL.`,
				});
			}
		}
		let subtreeFindings = 0;
		for (const context of census.contexts) {
			const lang = parseLang(context.lang);
			const family = lang ? LANGUAGE_FAMILY[lang.language] : undefined;
			if (!family) continue;
			const dominant = dominantOf(context);
			if (!dominant || dominant.total < MISMATCH_MIN_LETTERS || dominant.share < MISMATCH_SHARE) continue;
			if (dominant.family === family) continue;
			if (!context.isRoot && subtreeFindings >= 5) continue;
			if (!context.isRoot) subtreeFindings += 1;
			const share = Math.round(dominant.share * 100);
			const sample = context.samples[dominant.family]?.[0];
			const where = context.isRoot
				? `<html lang="${context.lang}">`
				: `${context.selector} with lang="${context.lang}"`;
			report(ctx, out, "i18n/lang-mismatch", {
				title: `lang="${context.lang}" but the text is ${FAMILY_NAMES[dominant.family]}`,
				message: `${where} declares a ${FAMILY_NAMES[family]}-script language, but ${share}% of the visible letters inside it are ${FAMILY_NAMES[dominant.family]}${sample ? `, for example "${truncate(sample, 60)}"` : ""}.`,
				subject: `${context.isRoot ? "html" : context.selector}:${context.lang}`,
				location: { selector: context.selector },
				evidence: { snippet: sample },
			});
		}
	}
	return out;
}
