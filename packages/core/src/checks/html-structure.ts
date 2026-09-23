/**
 * A bounded structural check over HTML source for html/valid. It is not a validator: it walks the
 * tags the server sent with a small tokenizer and an open-element stack, and reports the errors a
 * browser silently repairs — stray and mismatched end tags, elements left open, duplicate attributes,
 * self-closing syntax on non-void elements, nested links, list children that are not `<li>` and block
 * content inside `<p>`. Implied end tags (`<li>`, `<p>`, `<td>`, ...) are honoured the way the
 * parser honours them, so valid documents that rely on them stay quiet.
 */

export type MarkupProblemKind =
	| "stray-end-tag"
	| "unclosed"
	| "duplicate-attribute"
	| "self-closing"
	| "nested-a"
	| "list-child"
	| "block-in-p";

export interface MarkupProblem {
	kind: MarkupProblemKind;
	/** 1-based line in the served source. */
	line: number;
	/** The element the problem is about, lowercase. */
	tag: string;
	message: string;
}

export interface MarkupCheckOptions {
	/** Stop after this many problems. */
	maxProblems?: number;
	/** Only this many characters of the source are read; the tail of a huge document is ignored. */
	maxChars?: number;
}

const VOID = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"source",
	"track",
	"wbr",
	"param",
	"keygen",
	"basefont",
	"bgsound",
	"frame",
	"command",
]);

/** Elements whose content is text until the matching end tag. */
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes"]);

/** Elements whose end tag may be omitted; leaving them open is never an error. */
const OPTIONAL_END = new Set([
	"html",
	"head",
	"body",
	"p",
	"li",
	"dt",
	"dd",
	"option",
	"optgroup",
	"rb",
	"rp",
	"rt",
	"rtc",
	"tbody",
	"td",
	"tfoot",
	"th",
	"thead",
	"tr",
	"colgroup",
	"caption",
]);

/** Start tags that close an open `<p>`; all but `p` itself are also not allowed inside one. */
const CLOSES_P = new Set([
	"address",
	"article",
	"aside",
	"blockquote",
	"details",
	"dialog",
	"div",
	"dl",
	"fieldset",
	"figcaption",
	"figure",
	"footer",
	"form",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"header",
	"hgroup",
	"hr",
	"main",
	"menu",
	"nav",
	"ol",
	"p",
	"pre",
	"search",
	"section",
	"table",
	"ul",
	"li",
	"dt",
	"dd",
]);

/** Start tags that implicitly close these open elements when they are on top of the stack. */
const IMPLIED_CLOSE: Record<string, ReadonlySet<string>> = {
	li: new Set(["li"]),
	dt: new Set(["dt", "dd"]),
	dd: new Set(["dt", "dd"]),
	option: new Set(["option"]),
	optgroup: new Set(["option", "optgroup"]),
	tr: new Set(["tr", "td", "th"]),
	td: new Set(["td", "th"]),
	th: new Set(["td", "th"]),
	thead: new Set(["tr", "td", "th", "tbody", "thead", "tfoot", "caption", "colgroup"]),
	tbody: new Set(["tr", "td", "th", "tbody", "thead", "tfoot", "caption", "colgroup"]),
	tfoot: new Set(["tr", "td", "th", "tbody", "thead", "tfoot", "caption", "colgroup"]),
	rb: new Set(["rb", "rt", "rp", "rtc"]),
	rt: new Set(["rb", "rt", "rp"]),
	rp: new Set(["rb", "rt", "rp"]),
	rtc: new Set(["rb", "rt", "rp", "rtc"]),
};

const LIST_CHILDREN = new Set(["li", "script", "template"]);

interface OpenElement {
	name: string;
	line: number;
}

interface StartTag {
	name: string;
	attrs: string[];
	duplicates: string[];
	selfClosing: boolean;
	/** Index just past the `>`; `undefined` when the source ended inside the tag. */
	end: number | undefined;
}

function parseStartTag(source: string, from: number): StartTag {
	const n = source.length;
	let i = from + 1;
	const nameStart = i;
	while (i < n && !/[\s/>]/.test(source[i]!)) i++;
	const name = source.slice(nameStart, i).toLowerCase();
	const attrs: string[] = [];
	const duplicates: string[] = [];
	const seen = new Set<string>();
	let selfClosing = false;
	while (i < n) {
		while (i < n && /\s/.test(source[i]!)) i++;
		if (i >= n) break;
		const ch = source[i]!;
		if (ch === ">") return { name, attrs, duplicates, selfClosing, end: i + 1 };
		if (ch === "/") {
			if (source[i + 1] === ">") {
				selfClosing = true;
				return { name, attrs, duplicates, selfClosing, end: i + 2 };
			}
			i++;
			continue;
		}
		const attrStart = i;
		while (i < n && !/[\s=>]/.test(source[i]!) && !(source[i] === "/" && source[i + 1] === ">")) i++;
		const attr = source.slice(attrStart, i).toLowerCase();
		if (attr) {
			if (seen.has(attr)) duplicates.push(attr);
			seen.add(attr);
			attrs.push(attr);
		}
		while (i < n && /\s/.test(source[i]!)) i++;
		if (source[i] === "=") {
			i++;
			while (i < n && /\s/.test(source[i]!)) i++;
			const quote = source[i];
			if (quote === '"' || quote === "'") {
				const close = source.indexOf(quote, i + 1);
				if (close < 0) return { name, attrs, duplicates, selfClosing, end: undefined };
				i = close + 1;
			} else {
				while (i < n && !/[\s>]/.test(source[i]!)) i++;
			}
		}
		if (i === attrStart) i++; // never stall on an unexpected character
	}
	return { name, attrs, duplicates, selfClosing, end: undefined };
}

/** Structural problems in `source`, in document order. */
export function checkMarkupStructure(source: string, opts: MarkupCheckOptions = {}): MarkupProblem[] {
	const maxProblems = opts.maxProblems ?? 50;
	const maxChars = opts.maxChars ?? 1_500_000;
	const truncated = source.length > maxChars;
	const text = truncated ? source.slice(0, maxChars) : source;
	const n = text.length;
	const problems: MarkupProblem[] = [];
	const stack: OpenElement[] = [];
	// The last <p> a block start tag closed implicitly. Omitting </p> before a block is fine; an
	// explicit </p> arriving afterwards shows the block was meant to sit inside the paragraph.
	let impliedP: { pLine: number; by: string; byLine: number } | undefined;
	let i = 0;
	let line = 1;
	let linePos = 0;
	const advance = (to: number) => {
		for (let k = linePos; k < to && k < n; k++) if (text[k] === "\n") line++;
		linePos = Math.max(linePos, Math.min(to, n));
	};
	const add = (problem: MarkupProblem) => {
		if (problems.length < maxProblems) problems.push(problem);
	};
	const full = () => problems.length >= maxProblems;
	const top = () => stack[stack.length - 1]?.name;
	const inForeign = () => stack.some((el) => el.name === "svg" || el.name === "math");
	const has = (name: string) => stack.some((el) => el.name === name);

	const handleStart = (tag: StartTag, tagLine: number) => {
		const { name } = tag;
		for (const attr of tag.duplicates) {
			add({
				kind: "duplicate-attribute",
				line: tagLine,
				tag: name,
				message: `Attribute "${attr}" appears more than once on <${name}> (line ${tagLine}); the browser keeps the first value.`,
			});
		}
		const foreign = inForeign();
		if (!foreign) {
			if (name === "p") impliedP = undefined;
			if (CLOSES_P.has(name) && top() === "p") {
				const p = stack.pop()!;
				if (name !== "p") impliedP = { pLine: p.line, by: name, byLine: tagLine };
			}
			const closes = IMPLIED_CLOSE[name];
			if (closes) while (stack.length && closes.has(top()!)) stack.pop();
			if (name === "a" && has("a")) {
				const outer = [...stack].reverse().find((el) => el.name === "a")!;
				add({
					kind: "nested-a",
					line: tagLine,
					tag: "a",
					message: `<a> (line ${tagLine}) is nested inside the <a> opened on line ${outer.line}; links cannot contain links.`,
				});
				while (stack.length && stack.pop()!.name !== "a") {
					// the browser closes the outer link before opening the inner one
				}
			}
			const parent = top();
			if ((parent === "ul" || parent === "ol") && !LIST_CHILDREN.has(name)) {
				add({
					kind: "list-child",
					line: tagLine,
					tag: name,
					message: `<${name}> (line ${tagLine}) is a direct child of <${parent}>; only <li> is allowed there.`,
				});
			}
		}
		if (VOID.has(name)) return;
		if (tag.selfClosing) {
			if (foreign || name === "svg" || name === "math") return;
			add({
				kind: "self-closing",
				line: tagLine,
				tag: name,
				message: `<${name}/> (line ${tagLine}) does not close the element in HTML; the browser treats it as an open <${name}>.`,
			});
		}
		stack.push({ name, line: tagLine });
	};

	const handleEnd = (name: string, tagLine: number) => {
		let index = -1;
		for (let k = stack.length - 1; k >= 0; k--) {
			if (stack[k]!.name === name) {
				index = k;
				break;
			}
		}
		if (index < 0) {
			if (name === "html" || name === "head" || name === "body") return;
			if (name === "p" && impliedP) {
				add({
					kind: "block-in-p",
					line: tagLine,
					tag: "p",
					message: `</p> (line ${tagLine}) closes the paragraph from line ${impliedP.pLine}, but the browser already ended it when <${impliedP.by}> started on line ${impliedP.byLine}; a paragraph cannot contain <${impliedP.by}>.`,
				});
				impliedP = undefined;
				return;
			}
			add({
				kind: "stray-end-tag",
				line: tagLine,
				tag: name,
				message: `</${name}> (line ${tagLine}) has no matching open element.`,
			});
			return;
		}
		for (let k = stack.length - 1; k > index; k--) {
			const el = stack[k]!;
			if (OPTIONAL_END.has(el.name)) continue;
			add({
				kind: "unclosed",
				line: el.line,
				tag: el.name,
				message: `<${el.name}> opened on line ${el.line} is still open when </${name}> closes on line ${tagLine}.`,
			});
		}
		stack.length = index;
	};

	while (i < n && !full()) {
		const lt = text.indexOf("<", i);
		if (lt < 0) break;
		advance(lt);
		i = lt;
		if (text.startsWith("<!--", i)) {
			const end = text.indexOf("-->", i + 4);
			i = end < 0 ? n : end + 3;
			continue;
		}
		if (text.startsWith("<![CDATA[", i)) {
			const end = text.indexOf("]]>", i + 9);
			i = end < 0 ? n : end + 3;
			continue;
		}
		if (text[i + 1] === "!" || text[i + 1] === "?") {
			const end = text.indexOf(">", i + 2);
			i = end < 0 ? n : end + 1;
			continue;
		}
		if (text[i + 1] === "/") {
			const m = /^<\/([a-zA-Z][^\s/>]*)[^>]*>/.exec(text.slice(i, i + 200));
			if (!m) {
				i += 2;
				continue;
			}
			handleEnd(m[1]!.toLowerCase(), line);
			i += m[0].length;
			continue;
		}
		if (/[a-zA-Z]/.test(text[i + 1] ?? "")) {
			const tag = parseStartTag(text, i);
			if (tag.end === undefined) break;
			const tagLine = line;
			advance(tag.end);
			i = tag.end;
			handleStart(tag, tagLine);
			if (tag.name === "plaintext") break;
			if (RAW_TEXT.has(tag.name) && !VOID.has(tag.name) && !tag.selfClosing) {
				const close = new RegExp(`</${tag.name}[\\s/>]`, "i");
				const rest = text.slice(i);
				const m = close.exec(rest);
				if (!m) {
					i = n;
					break;
				}
				i += m.index;
			}
			continue;
		}
		i += 1;
	}

	if (!truncated && !full()) {
		advance(n);
		for (const el of [...stack].reverse()) {
			if (OPTIONAL_END.has(el.name)) continue;
			add({
				kind: "unclosed",
				line: el.line,
				tag: el.name,
				message: `<${el.name}> opened on line ${el.line} is never closed.`,
			});
		}
	}
	return problems.sort((a, b) => a.line - b.line);
}
