import { Marked } from "marked";

/** Turns a heading (or rule id) into a URL fragment: `links/broken` -> `links-broken`. */
export function slugify(input: string): string {
	return input
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[`*_~]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** Makes every slug in one document unique: `intro`, `intro-2`, `intro-3`, ... */
export function createSlugger(): (text: string) => string {
	const seen = new Map<string, number>();
	return (text: string) => {
		const base = slugify(text) || "section";
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		return count === 0 ? base : `${base}-${count + 1}`;
	};
}

export interface Frontmatter {
	title?: string;
	description?: string;
	order?: number;
}

export interface ParsedMarkdown {
	frontmatter: Frontmatter;
	body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Minimal YAML frontmatter reader. Documentation frontmatter is a flat `key: value` block
 * (title, description, order), so a full YAML parser would be overkill in the browser bundle.
 */
export function parseFrontmatter(source: string): ParsedMarkdown {
	const match = FRONTMATTER_RE.exec(source);
	if (!match) return { frontmatter: {}, body: source };

	const frontmatter: Frontmatter = {};
	for (const line of (match[1] ?? "").split(/\r?\n/)) {
		const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
		if (!pair) continue;
		const key = pair[1] ?? "";
		let value = (pair[2] ?? "").trim();
		if (
			(value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
			(value.startsWith("'") && value.endsWith("'") && value.length > 1)
		) {
			value = value.slice(1, -1);
		}
		if (key === "order") {
			const n = Number(value);
			if (Number.isFinite(n)) frontmatter.order = n;
		} else if (key === "title") {
			frontmatter.title = value;
		} else if (key === "description") {
			frontmatter.description = value;
		}
	}
	return { frontmatter, body: source.slice(match[0].length) };
}

export interface HeadingEntry {
	depth: number;
	id: string;
	text: string;
}

export interface RenderedMarkdown {
	html: string;
	headings: HeadingEntry[];
}

function stripTags(html: string): string {
	return html
		.replace(/<[^>]*>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.trim();
}

/**
 * Rewrites a link found inside a documentation page so it points at a site route.
 *
 * `./flows.md`, `flows.md`, `../concepts/baseline.md#anchor` -> `/docs/<slug>[#anchor]`.
 * Absolute and external links are left alone.
 */
export function resolveDocLink(href: string, fromSlug: string): string {
	if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//") || href.startsWith("#")) {
		return href;
	}
	if (href.startsWith("/")) return href;

	const hashIndex = href.indexOf("#");
	const hash = hashIndex === -1 ? "" : href.slice(hashIndex);
	const path = hashIndex === -1 ? href : href.slice(0, hashIndex);
	if (!path) return href;
	if (!/\.md$/i.test(path)) return href;

	const fromSegments = fromSlug.split("/").slice(0, -1);
	for (const segment of path.split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") fromSegments.pop();
		else fromSegments.push(segment);
	}
	let slug = fromSegments.join("/").replace(/\.md$/i, "");
	if (slug.endsWith("/index")) slug = slug.slice(0, -"/index".length);
	if (slug === "index") return `/docs${hash}`;
	return `/docs/${slug}${hash}`;
}

/** Compiles a documentation body to HTML with stable heading ids and rewritten internal links. */
export function renderMarkdown(body: string, options: { slug: string }): RenderedMarkdown {
	const headings: HeadingEntry[] = [];
	const slugger = createSlugger();
	const marked = new Marked({ gfm: true, breaks: false });

	marked.use({
		renderer: {
			heading(token) {
				// `this` is bound to the renderer by marked.
				const inner = this.parser.parseInline(token.tokens);
				const text = stripTags(inner);
				const id = slugger(text);
				headings.push({ depth: token.depth, id, text });
				return `<h${token.depth} id="${id}">${inner}</h${token.depth}>\n`;
			},
			link(token) {
				const href = resolveDocLink(token.href ?? "", options.slug);
				const inner = this.parser.parseInline(token.tokens);
				const title = token.title ? ` title="${token.title}"` : "";
				const external = /^https?:\/\//i.test(href) && !href.startsWith("https://gribble.dev");
				const rel = external ? ' rel="noreferrer noopener"' : "";
				return `<a href="${href}"${title}${rel}>${inner}</a>`;
			},
		},
	});

	const html = marked.parse(body, { async: false });
	return { html, headings };
}
