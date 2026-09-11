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

/** Normalize a directory-derived route: drop route groups, parallel slots and index segments. */
function cleanSegments(segments: string[]): string[] | undefined {
	const out: string[] = [];
	for (const raw of segments) {
		if (!raw) continue;
		if (raw.startsWith("(") && raw.endsWith(")")) continue; // route group
		if (raw.startsWith("@")) continue; // parallel route slot
		if (raw.startsWith("_")) return undefined; // private folder
		let seg = raw;
		const optionalCatchAll = seg.match(/^\[\[\.\.\.(.+)\]\]$/);
		if (optionalCatchAll) seg = `[...${optionalCatchAll[1]}]`;
		out.push(seg);
	}
	return out;
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
		const segments = cleanSegments(file.split("/").slice(0, -1));
		if (!segments) continue;
		addRoute(result, toRoute(segments), `${appDir}/${file}`);
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
		const segments = cleanSegments(parts);
		if (!segments) continue;
		if (base !== "index") segments.push(base);
		const mapped = opts.nuxt ? segments.map((s) => (s.startsWith("_") ? `[${s.slice(1)}]` : s)) : segments;
		addRoute(result, toRoute(mapped), `${pages}/${file}`);
	}
}

async function sveltekit(dir: string, result: DiscoveredRoutes): Promise<void> {
	const files = await glob(join(dir, "src/routes"), ["**/+page.{svelte,md,svx}"]);
	for (const file of files) {
		const segments = cleanSegments(file.split("/").slice(0, -1));
		if (!segments) continue;
		addRoute(result, toRoute(segments), `src/routes/${file}`);
	}
}

function remixRoute(name: string): string | undefined {
	// Flat routes: `_index` -> "/", `blog.$slug` -> "/blog/[slug]", `_layout.child` -> "/child", `($lang).about` -> "/about".
	const raw = name.replace(/\.route$/, "");
	if (raw === "_index" || raw === "index") return "/";
	const segments: string[] = [];
	for (const partRaw of raw.split(".")) {
		let part = partRaw;
		if (part === "_index" || part === "") continue;
		if (part.startsWith("_")) continue; // pathless layout
		part = part.replace(/^\((.*)\)$/, "$1"); // optional segment
		if (part === "") continue;
		if (part.startsWith("$")) part = part === "$" ? "[...splat]" : `[${part.slice(1)}]`;
		segments.push(part.replace(/\[\./g, "["));
	}
	return toRoute(segments);
}

async function remix(dir: string, result: DiscoveredRoutes): Promise<void> {
	const files = await glob(join(dir, "app/routes"), ["*.{tsx,jsx,ts,js,mdx}", "*/route.{tsx,jsx,ts,js}"]);
	for (const file of files) {
		const name = file.includes("/") ? file.split("/")[0]! : file.replace(/\.[^.]+$/, "");
		const route = remixRoute(name);
		if (route !== undefined) addRoute(result, route, `app/routes/${file}`);
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
