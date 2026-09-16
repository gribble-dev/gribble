/**
 * Framework route discovery from the file system. Dynamic segments are normalized to `[param]`
 * (catch-alls to `[...param]`) so routes line up with `normalizeRoute()` and the baseline.
 */
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import fg from "fast-glob";

export type Framework =
	| "next-app"
	| "next-pages"
	| "sveltekit"
	| "nuxt"
	| "astro"
	| "remix"
	| "react-router"
	| "vite-spa";

export interface DiscoveredRoutes {
	framework?: Framework;
	/** Path patterns, dynamic segments as `[param]`. */
	routes: string[];
	/** Route -> source file (relative to `targetDir`, posix separators). */
	source: Record<string, string>;
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function anyExists(dir: string, names: string[]): Promise<boolean> {
	for (const name of names) if (await exists(join(dir, name))) return true;
	return false;
}

async function packageDeps(dir: string): Promise<Set<string>> {
	try {
		const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		return new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
	} catch {
		return new Set();
	}
}

const IGNORE = [
	"**/node_modules/**",
	"**/.git/**",
	"**/dist/**",
	"**/build/**",
	"**/.next/**",
	"**/.svelte-kit/**",
];

async function glob(cwd: string, patterns: string[]): Promise<string[]> {
	if (!(await exists(cwd))) return [];
	const found = await fg(patterns, { cwd, ignore: IGNORE, onlyFiles: true, dot: false });
	return found.map((f) => f.replace(/\\/g, "/")).sort();
}

/** One path segment of a route, as it appears in a route pattern. */
interface Segment {
	/** The segment itself: `about`, `[slug]`, `[...rest]`. */
	value: string;
	/** True when the URL may omit this segment entirely (SvelteKit `[[lang]]`, Remix `($lang)`). */
	optional?: boolean;
}

/** Normalize a directory-derived route: drop route groups, parallel slots and index segments. */
function cleanSegments(segments: string[]): Segment[] | undefined {
	const out: Segment[] = [];
	for (const raw of segments) {
		if (!raw) continue;
		if (raw.startsWith("(") && raw.endsWith(")")) continue; // route group
		// Next.js intercepting routes (`(.)photo`, `(..)(..)photo`) re-render a route that already
		// exists elsewhere in the tree; they add no URL of their own, so they are nothing to audit.
		if (/^(?:\(\.{1,3}\))+/.test(raw)) return undefined;
		if (raw.startsWith("@")) continue; // parallel route slot
		if (raw.startsWith("_")) return undefined; // private folder
		// `[[lang]]` and `[[...rest]]` may both be absent from the URL; expandOptional() emits both forms.
		const optional = raw.match(/^\[\[(.+)\]\]$/);
		out.push(optional ? { value: `[${optional[1]}]`, optional: true } : { value: raw });
	}
	return out;
}

/**
 * Upper bound on the variants a single route expands to. `n` optional segments yield `2 ** n`
 * variants, so a route with a handful of them would flood discovery. Past the cap we keep the two
 * ends deterministically (every optional segment absent, which is the canonical path, and every one
 * present) and drop the combinations in between.
 */
const MAX_OPTIONAL_VARIANTS = 16;

/**
 * Expand optional segments into every path the route actually serves: `[[lang]]/about` answers both
 * `/about` and `/fr/about`. Bit `k` of the mask marks the k-th optional segment as present, so mask
 * `0` is the all-absent (canonical) variant and it comes first: `/about` wins the `source` mapping
 * over `/[lang]/about`.
 */
function expandOptional(segments: Segment[]): string[][] {
	const optional = segments.flatMap((seg, i) => (seg.optional ? [i] : []));
	if (optional.length === 0) return [segments.map((seg) => seg.value)];
	const total = 2 ** optional.length;
	const masks =
		total <= MAX_OPTIONAL_VARIANTS ? Array.from({ length: total }, (_unused, mask) => mask) : [0, total - 1];
	return masks.map((mask) =>
		segments
			.filter((_seg, i) => {
				const bit = optional.indexOf(i);
				return bit === -1 || (mask & (1 << bit)) !== 0;
			})
			.map((seg) => seg.value),
	);
}

/** Clean a directory-derived route and expand it: one segment list per path it serves. */
function routeVariants(segments: string[]): string[][] {
	const cleaned = cleanSegments(segments);
	return cleaned ? expandOptional(cleaned) : [];
}

function toRoute(segments: string[]): string {
	return `/${segments.join("/")}`.replace(/\/+/g, "/") || "/";
}

function addRoute(result: DiscoveredRoutes, route: string, file: string): void {
	const normalized = route === "" ? "/" : route;
	if (!result.source[normalized]) {
		result.routes.push(normalized);
		result.source[normalized] = file;
	}
}

async function nextApp(dir: string, appDir: string, result: DiscoveredRoutes): Promise<void> {
	const files = await glob(join(dir, appDir), ["**/page.{tsx,jsx,js,ts,mdx,md}"]);
	for (const file of files) {
		for (const variant of routeVariants(file.split("/").slice(0, -1))) {
			addRoute(result, toRoute(variant), `${appDir}/${file}`);
		}
	}
}

async function pagesDir(
	dir: string,
	pages: string,
	exts: string,
	result: DiscoveredRoutes,
	opts: { nuxt?: boolean } = {},
): Promise<void> {
	const files = await glob(
		join(dir, pages),
		exts.split(",").map((ext) => `**/*.${ext}`),
	);
	for (const file of files) {
		const parts = file.split("/");
		const base = parts.pop()!.replace(/\.[^.]+$/, "");
		if (!opts.nuxt && (base.startsWith("_") || parts[0] === "api")) continue;
		// The file name carries the same syntax as a directory (`docs/[[...slug]].tsx`), so it joins
		// the segment list before cleaning rather than being appended raw afterwards.
		const raw = base === "index" ? parts : [...parts, base];
		// Nuxt 2 spells dynamic segments `_id`, which would otherwise read as a private folder.
		const named = opts.nuxt ? raw.map((s) => (s.startsWith("_") ? `[${s.slice(1)}]` : s)) : raw;
		for (const variant of routeVariants(named)) {
			addRoute(result, toRoute(variant), `${pages}/${file}`);
		}
	}
}

/**
 * Drop the `=matcher` suffix from SvelteKit parameters: in `[lang=locale]` the `=locale` names a
 * validator in `src/params/` and is not part of the parameter. Handles rest and optional forms
 * (`[...rest=matcher]`, `[[lang=locale]]`) and segments holding several parameters, because the
 * inner-bracket match never spans a `[` or `]`.
 */
function stripMatchers(segment: string): string {
	return segment.replace(/\[([^[\]]*)\]/g, (_full, inner: string) => `[${inner.split("=")[0]}]`);
}

async function sveltekit(dir: string, result: DiscoveredRoutes): Promise<void> {
	const files = await glob(join(dir, "src/routes"), ["**/+page.{svelte,md,svx}"]);
	for (const file of files) {
		const raw = file.split("/").slice(0, -1).map(stripMatchers);
		for (const variant of routeVariants(raw)) {
			addRoute(result, toRoute(variant), `src/routes/${file}`);
		}
	}
}

/** `$slug` -> `[slug]`, `$` -> `[...splat]`; anything else is literal, where `[.]` escapes a dot. */
function remixParam(part: string): string {
	if (part === "$") return "[...splat]";
	if (part.startsWith("$")) return `[${part.slice(1)}]`;
	return part.replace(/\[\./g, "[");
}

function remixSegments(name: string): Segment[] {
	// Flat routes: `_index` -> "/", `blog.$slug` -> "/blog/[slug]", `_layout.child` -> "/child".
	const raw = name.replace(/\.route$/, "");
	if (raw === "_index" || raw === "index") return [];
	const segments: Segment[] = [];
	for (const part of raw.split(".")) {
		if (part === "_index" || part === "") continue;
		if (part.startsWith("_")) continue; // pathless layout
		// `($lang).about` serves both `/about` and `/en/about`, so the segment is optional, not dropped.
		const optional = part.match(/^\((.*)\)$/);
		if (optional) {
			if (optional[1] === "") continue;
			segments.push({ value: remixParam(optional[1]!), optional: true });
			continue;
		}
		segments.push({ value: remixParam(part) });
	}
	return segments;
}

async function remix(dir: string, result: DiscoveredRoutes): Promise<void> {
	const files = await glob(join(dir, "app/routes"), ["*.{tsx,jsx,ts,js,mdx}", "*/route.{tsx,jsx,ts,js}"]);
	for (const file of files) {
		const name = file.includes("/") ? file.split("/")[0]! : file.replace(/\.[^.]+$/, "");
		for (const variant of expandOptional(remixSegments(name))) {
			addRoute(result, toRoute(variant), `app/routes/${file}`);
		}
	}
}

/** Discover routes from framework conventions under `targetDir`. */
export async function discoverRoutes(targetDir: string): Promise<DiscoveredRoutes> {
	const result: DiscoveredRoutes = { routes: [], source: {} };
	const deps = await packageDeps(targetDir);

	if (
		(await anyExists(targetDir, ["next.config.js", "next.config.mjs", "next.config.ts"])) ||
		deps.has("next")
	) {
		for (const appDir of ["app", "src/app"]) {
			if (await exists(join(targetDir, appDir))) {
				await nextApp(targetDir, appDir, result);
				if (result.routes.length > 0) result.framework = "next-app";
			}
		}
		for (const pages of ["pages", "src/pages"]) {
			if (await exists(join(targetDir, pages))) {
				await pagesDir(targetDir, pages, "tsx,jsx,js,ts,mdx,md", result);
				if (result.routes.length > 0 && !result.framework) result.framework = "next-pages";
			}
		}
		if (result.framework) return finish(result);
	}
	if (await anyExists(targetDir, ["svelte.config.js", "svelte.config.ts", "svelte.config.mjs"])) {
		await sveltekit(targetDir, result);
		if (result.routes.length > 0) return finish({ ...result, framework: "sveltekit" });
	}
	if (await anyExists(targetDir, ["nuxt.config.js", "nuxt.config.ts", "nuxt.config.mjs"])) {
		for (const pages of ["pages", "app/pages", "src/pages"]) {
			if (await exists(join(targetDir, pages)))
				await pagesDir(targetDir, pages, "vue", result, { nuxt: true });
		}
		if (result.routes.length > 0) return finish({ ...result, framework: "nuxt" });
	}
	if (await anyExists(targetDir, ["astro.config.mjs", "astro.config.ts", "astro.config.js"])) {
		await pagesDir(targetDir, "src/pages", "astro,md,mdx,html", result);
		if (result.routes.length > 0) return finish({ ...result, framework: "astro" });
	}
	const remixLike = [...deps].some((d) => d.startsWith("@remix-run/")) || deps.has("@react-router/dev");
	if (remixLike && (await exists(join(targetDir, "app/routes")))) {
		await remix(targetDir, result);
		if (result.routes.length > 0) {
			return finish({ ...result, framework: deps.has("@react-router/dev") ? "react-router" : "remix" });
		}
	}
	if (
		(await anyExists(targetDir, ["vite.config.ts", "vite.config.js", "vite.config.mjs"])) &&
		(await exists(join(targetDir, "index.html")))
	) {
		addRoute(result, "/", "index.html");
		return finish({
			...result,
			framework: deps.has("react-router") || deps.has("react-router-dom") ? "react-router" : "vite-spa",
		});
	}
	return finish(result);
}

function finish(result: DiscoveredRoutes): DiscoveredRoutes {
	const routes = [...new Set(result.routes)].sort(
		(a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
	);
	return { framework: result.framework, routes, source: result.source };
}
