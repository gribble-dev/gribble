/**
 * Loads the documentation source from the repo-root `docs/` folder at build time.
 *
 * Everything here runs during prerendering only — the Worker never reads the file system.
 */
import { type Frontmatter, type HeadingEntry, parseFrontmatter, renderMarkdown } from "$lib/markdown";

const modules = import.meta.glob("../../../../../docs/**/*.md", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

export interface DocPage {
	/** Route slug without a leading slash, e.g. `concepts/baseline`. `""` for `docs/index.md`. */
	slug: string;
	/** Path relative to the repo root, e.g. `docs/concepts/baseline.md`. */
	sourcePath: string;
	title: string;
	description: string;
	order: number;
	/** Folder the page lives in (`""` for top-level pages). */
	group: string;
	/** Raw markdown, frontmatter included. */
	raw: string;
	/** Markdown body with the frontmatter stripped. */
	body: string;
}

export interface DocGroup {
	id: string;
	label: string;
	pages: DocPage[];
}

function titleFromSlug(slug: string): string {
	const last = slug.split("/").pop() ?? "";
	if (!last) return "Overview";
	return last
		.split("-")
		.map((word) => (word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
		.join(" ");
}

function groupLabel(group: string): string {
	if (!group) return "Overview";
	return titleFromSlug(group);
}

function toSlug(path: string): string {
	const relative = path.replace(/^.*\/docs\//, "").replace(/\.md$/i, "");
	if (relative === "index") return "";
	return relative.replace(/\/index$/i, "");
}

function build(): DocPage[] {
	const pages: DocPage[] = [];
	for (const [path, raw] of Object.entries(modules)) {
		const fileName = path.split("/").pop() ?? "";
		// `_`-prefixed files are scratch/placeholder documents, and `README.md` files are notes for
		// contributors browsing the folder on GitHub; neither is published.
		if (fileName.startsWith("_") || fileName === "README.md") continue;

		const slug = toSlug(path);
		const { frontmatter, body } = parseFrontmatter(raw);
		const fm: Frontmatter = frontmatter;
		const segments = slug.split("/");
		pages.push({
			slug,
			sourcePath: `docs/${path.replace(/^.*\/docs\//, "")}`,
			title: fm.title ?? (slug === "" ? "Documentation" : titleFromSlug(slug)),
			description: fm.description ?? "",
			order: fm.order ?? 1000,
			group: segments.length > 1 ? segments[0]! : "",
			raw,
			body,
		});
	}
	pages.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
	return pages;
}

const pages = build();
const bySlug = new Map(pages.map((page) => [page.slug, page]));

export function allDocs(): DocPage[] {
	return pages;
}

export function getDoc(slug: string): DocPage | undefined {
	return bySlug.get(slug);
}

/** Pages grouped by folder; top-level pages first, then folders ordered by their first page. */
export function docGroups(): DocGroup[] {
	const groups = new Map<string, DocPage[]>();
	for (const page of pages) {
		const list = groups.get(page.group);
		if (list) list.push(page);
		else groups.set(page.group, [page]);
	}
	const result: DocGroup[] = [];
	for (const [id, list] of groups) {
		result.push({ id, label: groupLabel(id), pages: list });
	}
	result.sort((a, b) => {
		if (a.id === "" && b.id !== "") return -1;
		if (b.id === "" && a.id !== "") return 1;
		const aOrder = a.pages[0]?.order ?? 1000;
		const bOrder = b.pages[0]?.order ?? 1000;
		return aOrder - bOrder || a.label.localeCompare(b.label);
	});
	return result;
}

export interface RenderedDoc {
	html: string;
	headings: HeadingEntry[];
}

const LEADING_H1 = /^\s*<h1[^>]*>[\s\S]*?<\/h1>\s*/;

/**
 * Compiles a page to HTML. The page title is rendered by the route as the single `<h1>`, so a
 * leading `<h1>` in the Markdown source is dropped to keep exactly one per page.
 */
export function renderDoc(page: DocPage): RenderedDoc {
	const { html, headings } = renderMarkdown(page.body, { slug: page.slug });
	return {
		html: html.replace(LEADING_H1, ""),
		headings: headings.filter((heading) => heading.depth === 2 || heading.depth === 3),
	};
}

/** Every slug the `/docs/[...slug]` route should prerender. `""` is served by `/docs` itself. */
export function docEntries(): Array<{ slug: string }> {
	return pages.filter((page) => page.slug !== "").map((page) => ({ slug: page.slug }));
}
