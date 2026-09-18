/**
 * html/* — doctype, charset, viewport meta, duplicate ids, obsolete markup and source structure.
 */
import type { Finding } from "../report/schema.js";
import { compilePatterns, report, ruleEnabled, ruleOptions, truncate } from "./finding.js";
import { checkMarkupStructure } from "./html-structure.js";
import { getSource } from "./page-data.js";
import type { CheckContext } from "./types.js";

interface HtmlInfo {
	doctype: { name: string; publicId: string; systemId: string } | null;
	charset: string | null;
	httpEquivCharset: string | null;
	viewport: string | null;
	duplicateIds: Array<{ id: string; count: number; tags: string[] }>;
}

function collectHtml(): HtmlInfo {
	const counts = new Map<string, { count: number; tags: string[] }>();
	for (const el of Array.from(document.querySelectorAll("[id]"))) {
		const id = el.getAttribute("id") ?? "";
		if (!id) continue;
		const entry = counts.get(id) ?? { count: 0, tags: [] };
		entry.count += 1;
		if (entry.tags.length < 3) entry.tags.push(el.tagName.toLowerCase());
		counts.set(id, entry);
	}
	const duplicateIds = [...counts.entries()]
		.filter(([, v]) => v.count > 1)
		.map(([id, v]) => ({ id, count: v.count, tags: v.tags }));
	const httpEquiv =
		document.querySelector('meta[http-equiv="Content-Type" i]')?.getAttribute("content") ?? null;
	return {
		doctype: document.doctype
			? {
					name: document.doctype.name,
					publicId: document.doctype.publicId,
					systemId: document.doctype.systemId,
				}
			: null,
		charset: document.querySelector("meta[charset]")?.getAttribute("charset") ?? null,
		httpEquivCharset: httpEquiv?.match(/charset=([^;\s]+)/i)?.[1] ?? null,
		viewport: document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? null,
		duplicateIds,
	};
}

interface ObsoleteUse {
	/** `center` for an element, `td[align]` for an attribute. */
	what: string;
	kind: "element" | "attribute";
	count: number;
	selector: string;
}

/** Obsolete elements and presentational attributes in the rendered DOM. Runs in the page. */
function findObsoleteMarkup(): ObsoleteUse[] {
	const ELEMENTS = [
		"center",
		"font",
		"marquee",
		"big",
		"strike",
		"tt",
		"acronym",
		"applet",
		"blink",
		"frame",
		"frameset",
		"basefont",
		"bgsound",
		"dir",
		"isindex",
		"keygen",
		"nobr",
		"plaintext",
		"spacer",
		"xmp",
	];
	const ATTRIBUTES: Array<[attr: string, tags: string[]]> = [
		[
			"align",
			[
				"caption",
				"col",
				"colgroup",
				"div",
				"embed",
				"h1",
				"h2",
				"h3",
				"h4",
				"h5",
				"h6",
				"hr",
				"iframe",
				"img",
				"input",
				"legend",
				"object",
				"p",
				"table",
				"tbody",
				"td",
				"tfoot",
				"th",
				"thead",
				"tr",
			],
		],
		["bgcolor", ["body", "table", "td", "th", "tr"]],
		["background", ["body", "table", "td", "th", "tr"]],
		["cellpadding", ["table"]],
		["cellspacing", ["table"]],
		["valign", ["col", "colgroup", "tbody", "td", "tfoot", "th", "thead", "tr"]],
		["hspace", ["img", "object", "embed"]],
		["vspace", ["img", "object", "embed"]],
		["nowrap", ["td", "th"]],
		["frameborder", ["iframe"]],
		["marginwidth", ["iframe"]],
		["marginheight", ["iframe"]],
		["border", ["img", "object"]],
		["clear", ["br"]],
		["noshade", ["hr"]],
		["color", ["hr"]],
		["link", ["body"]],
		["vlink", ["body"]],
		["alink", ["body"]],
		["text", ["body"]],
		["width", ["table", "td", "th", "hr", "pre", "col", "colgroup"]],
		["height", ["table", "td", "th", "tr"]],
	];
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
	const HTML_NS = "http://www.w3.org/1999/xhtml";
	const uses = new Map<string, ObsoleteUse>();
	const note = (what: string, kind: ObsoleteUse["kind"], el: Element) => {
		const entry = uses.get(what);
		if (entry) entry.count += 1;
		else uses.set(what, { what, kind, count: 1, selector: selectorFor(el) });
	};
	for (const el of Array.from(document.querySelectorAll(ELEMENTS.join(", ")))) {
		if (el.namespaceURI !== HTML_NS) continue;
		note(el.tagName.toLowerCase(), "element", el);
	}
	for (const [attr, tags] of ATTRIBUTES) {
		for (const el of Array.from(document.querySelectorAll(tags.map((t) => `${t}[${attr}]`).join(", ")))) {
			if (el.namespaceURI !== HTML_NS) continue;
			note(`${el.tagName.toLowerCase()}[${attr}]`, "attribute", el);
		}
	}
	return [...uses.values()];
}

const OBSOLETE_HINTS: Record<string, string> = {
	center: "Use `text-align: center` or `margin: 0 auto` in CSS.",
	font: "Use CSS `font-family`, `font-size` and `color`.",
	marquee: "Use a CSS animation that respects `prefers-reduced-motion`, or drop the effect.",
	big: "Use CSS `font-size`.",
	strike: "Use `<s>` for no-longer-accurate text or `<del>` for removed text.",
	tt: "Use `<code>`, `<kbd>` or `<samp>`, or CSS `font-family: monospace`.",
	acronym: "Use `<abbr>`.",
	applet: "Use `<object>` or `<embed>`.",
	blink: "Remove it; blinking text is not accessible.",
	frame: "Use `<iframe>` or a CSS layout.",
	frameset: "Use `<iframe>` or a CSS layout.",
	nobr: "Use CSS `white-space: nowrap`.",
};

/** html/doctype, html/charset, html/viewport-meta, html/duplicate-ids, html/deprecated-elements, html/valid. */
export async function checkHtml(ctx: CheckContext): Promise<Finding[]> {
	const out: Finding[] = [];
	const rules = [
		"html/doctype",
		"html/charset",
		"html/viewport-meta",
		"html/duplicate-ids",
		"html/deprecated-elements",
		"html/valid",
	];
	if (!rules.some((r) => ruleEnabled(ctx, r))) return out;

	if (ruleEnabled(ctx, "html/deprecated-elements")) {
		const uses = await ctx.page.raw.evaluate(findObsoleteMarkup).catch(() => [] as ObsoleteUse[]);
		for (const use of uses.slice(0, 20)) {
			const times = use.count === 1 ? "once" : `${use.count} times`;
			if (use.kind === "element") {
				report(ctx, out, "html/deprecated-elements", {
					title: `<${use.what}> is obsolete`,
					message: `<${use.what}> is used ${times} on ${ctx.route}; HTML removed it and browsers only keep it for compatibility.`,
					subject: use.what,
					location: { selector: use.selector },
					suggestion: OBSOLETE_HINTS[use.what],
				});
			} else {
				const [tag, attr] = use.what.split("[") as [string, string];
				report(ctx, out, "html/deprecated-elements", {
					title: `${attr.replace("]", "")} on <${tag}> is obsolete`,
					message: `The presentational attribute ${attr.replace("]", "")} is used ${times} on <${tag}> on ${ctx.route}; it is not part of HTML any more.`,
					subject: use.what,
					location: { selector: use.selector },
					suggestion: "Move the presentation to CSS.",
				});
			}
		}
	}

	if (ruleEnabled(ctx, "html/valid")) {
		const source = await getSource(ctx);
		if (source) {
			const ignore = compilePatterns(ruleOptions<{ ignore: string[] }>(ctx, "html/valid").ignore ?? []);
			const problems = checkMarkupStructure(source).filter((p) => !ignore.some((re) => re.test(p.message)));
			for (const problem of problems.slice(0, 20)) {
				report(ctx, out, "html/valid", {
					title: truncate(problem.message.replace(/\s*\(line \d+\)/, ""), 90),
					message: `${problem.message} Found in the served source of ${ctx.route}; the browser repaired it while parsing, so the rendered DOM may differ from the intent.`,
					subject: `${problem.kind}:${problem.tag}:${problem.line}`,
					location: { path: `document:${problem.line}` },
					evidence: { data: { kind: problem.kind, line: problem.line, tag: problem.tag } },
				});
			}
		}
	}

	const basics = ["html/doctype", "html/charset", "html/viewport-meta", "html/duplicate-ids"];
	if (!basics.some((r) => ruleEnabled(ctx, r))) return out;
	const info = await ctx.page.raw.evaluate(collectHtml);

	if (ruleEnabled(ctx, "html/doctype")) {
		if (!info.doctype) {
			report(ctx, out, "html/doctype", {
				title: "Document has no doctype",
				message: "Without <!DOCTYPE html> browsers render in quirks mode.",
				subject: "missing",
				location: { path: "document" },
			});
		} else if (info.doctype.name.toLowerCase() !== "html" || info.doctype.publicId || info.doctype.systemId) {
			report(ctx, out, "html/doctype", {
				title: "Document uses a legacy doctype",
				message: `Found <!DOCTYPE ${info.doctype.name}${info.doctype.publicId ? ` PUBLIC "${info.doctype.publicId}"` : ""}>; use <!DOCTYPE html>.`,
				subject: "legacy",
				location: { path: "document" },
			});
		}
	}

	if (ruleEnabled(ctx, "html/charset")) {
		const headerCharset = (
			ctx.cache?.navigation?.headers?.["content-type"] ??
			ctx.page.lastNavigation()?.headers?.["content-type"] ??
			""
		).match(/charset=([^;\s]+)/i)?.[1];
		const declared = info.charset ?? info.httpEquivCharset ?? headerCharset;
		if (!declared) {
			report(ctx, out, "html/charset", {
				title: "Document declares no charset",
				message: "Neither <meta charset> nor the Content-Type header names an encoding.",
				subject: "missing",
				location: { selector: "head" },
			});
		} else if (declared.toLowerCase().replace(/[^a-z0-9]/g, "") !== "utf8") {
			report(ctx, out, "html/charset", {
				title: `Document charset is ${declared}, not UTF-8`,
				message: `The declared encoding is "${declared}".`,
				subject: declared.toLowerCase(),
				location: { selector: "head" },
			});
		}
	}

	if (ruleEnabled(ctx, "html/viewport-meta") && !info.viewport) {
		report(ctx, out, "html/viewport-meta", {
			title: "Document has no viewport meta tag",
			message: "Mobile browsers will render the desktop layout and zoom out.",
			subject: "missing",
			location: { selector: "head" },
		});
	}

	if (ruleEnabled(ctx, "html/duplicate-ids")) {
		for (const dup of info.duplicateIds.slice(0, 20)) {
			report(ctx, out, "html/duplicate-ids", {
				title: `id="${truncate(dup.id, 40)}" is used ${dup.count} times`,
				message: `Elements: ${dup.tags.join(", ")}${dup.count > dup.tags.length ? ", …" : ""}. Duplicate ids break label associations, anchors and getElementById.`,
				subject: dup.id,
				location: { selector: `#${dup.id}` },
			});
		}
	}
	return out;
}
