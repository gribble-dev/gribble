/**
 * DOM -> source heuristics. Grep-based: a data-testid literal, an id literal, a unique text literal
 * or a class name is searched over the source files of the target app. The route's own file wins ties.
 * Symbols are component or function names, never line numbers (line is informational only).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fg from "fast-glob";
import type { FindingLocation } from "../report/schema.js";

export interface SourceMatch {
	/** Relative to `targetDir`, posix separators. */
	file: string;
	symbol?: string;
	line?: number;
	/** 0..1 */
	score: number;
	reason: string;
}

export interface MapDomToSourceOptions {
	targetDir: string;
	testId?: string;
	id?: string;
	text?: string;
	className?: string;
	route?: string;
	routeSource?: Record<string, string>;
}

const SOURCE_GLOBS = ["**/*.{ts,tsx,js,jsx,svelte,vue,astro,html,mdx,md}"];
const IGNORE = [
	"**/node_modules/**",
	"**/.git/**",
	"**/dist/**",
	"**/build/**",
	"**/.next/**",
	"**/.svelte-kit/**",
	"**/.output/**",
	"**/coverage/**",
	"**/.gribble/**",
	"**/*.d.ts",
	"**/*.test.*",
	"**/*.spec.*",
];
const MAX_FILES = 3000;
const MAX_FILE_BYTES = 512 * 1024;

interface SourceIndex {
	files: string[];
	contents: Map<string, string>;
	builtAt: number;
}

const indexes = new Map<string, Promise<SourceIndex>>();
const INDEX_TTL_MS = 60_000;

async function loadIndex(targetDir: string): Promise<SourceIndex> {
	const cached = indexes.get(targetDir);
	if (cached) {
		const index = await cached;
		if (Date.now() - index.builtAt < INDEX_TTL_MS) return index;
	}
	const pending = (async () => {
		const files = (await fg(SOURCE_GLOBS, { cwd: targetDir, ignore: IGNORE, onlyFiles: true }))
			.map((f) => f.replace(/\\/g, "/"))
			.sort()
			.slice(0, MAX_FILES);
		const contents = new Map<string, string>();
		await Promise.all(
			files.map(async (file) => {
				try {
					const text = await readFile(join(targetDir, file), "utf8");
					if (text.length <= MAX_FILE_BYTES) contents.set(file, text);
				} catch {
					// unreadable: skip
				}
			}),
		);
		return { files, contents, builtAt: Date.now() };
	})();
	indexes.set(targetDir, pending);
	return pending;
}

/** Drop the cached source index (tests and long-running processes). */
export function clearSourceIndex(targetDir?: string): void {
	if (targetDir) indexes.delete(targetDir);
	else indexes.clear();
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineOf(text: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
	return line;
}

const SYMBOL_PATTERNS = [
	/export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
	/(?:export\s+)?(?:async\s+)?function\s+([A-Z][\w$]*)/g,
	/(?:export\s+)?(?:const|let|var)\s+([A-Z][\w$]*)\s*(?::[^=]+)?=\s*(?:\(|async|forwardRef|memo|styled|function|React\.)/g,
	/class\s+([A-Z][\w$]*)/g,
];

/** Nearest component/function symbol declared before `offset`, else the file's base name for SFCs. */
export function symbolAt(file: string, text: string, offset: number): string | undefined {
	let best: { name: string; at: number } | undefined;
	for (const pattern of SYMBOL_PATTERNS) {
		for (const m of text.matchAll(pattern)) {
			if (m.index === undefined || m.index > offset) continue;
			if (!best || m.index > best.at) best = { name: m[1]!, at: m.index };
		}
	}
	if (best) return best.name;
	if (/\.(svelte|vue|astro)$/.test(file)) {
		const base = file
			.split("/")
			.pop()!
			.replace(/\.[^.]+$/, "");
		return base.startsWith("+") ? undefined : base;
	}
	return undefined;
}

interface Probe {
	pattern: RegExp;
	baseScore: number;
	reason: string;
}

function probes(opts: MapDomToSourceOptions): Probe[] {
	const out: Probe[] = [];
	if (opts.testId) {
		const id = escapeRegExp(opts.testId);
		out.push({
			pattern: new RegExp(
				`(?:data-testid|data-test-id|data-test|testid|testId)\\s*[=:]\\s*["'\`{]?\\s*["'\`]?${id}["'\`]`,
				"g",
			),
			baseScore: 0.9,
			reason: `data-testid "${opts.testId}"`,
		});
	}
	if (opts.id) {
		const id = escapeRegExp(opts.id);
		out.push({
			pattern: new RegExp(`\\bid\\s*[=:]\\s*["'\`{]?\\s*["'\`]?${id}["'\`]`, "g"),
			baseScore: 0.8,
			reason: `id "${opts.id}"`,
		});
	}
	const text = opts.text?.replace(/\s+/g, " ").trim();
	if (text && text.length >= 4 && text.length <= 120) {
		out.push({
			pattern: new RegExp(escapeRegExp(text), "g"),
			baseScore: 0.7,
			reason: `text "${text.slice(0, 40)}"`,
		});
	}
	if (opts.className) {
		const first = opts.className
			.split(/\s+/)
			.filter(
				(c) =>
					c.length >= 6 && !/^[a-z]+-\d+$/.test(c) && !/^(flex|grid|block|hidden|relative|absolute)$/.test(c),
			)
			.sort((a, b) => b.length - a.length)[0];
		if (first) {
			out.push({
				pattern: new RegExp(`\\b${escapeRegExp(first)}\\b`, "g"),
				baseScore: 0.4,
				reason: `class "${first}"`,
			});
		}
	}
	return out;
}

/** Map a DOM element to likely source files. Results are sorted by score, best first, at most five. */
export async function mapDomToSource(opts: MapDomToSourceOptions): Promise<SourceMatch[]> {
	const list = probes(opts);
	if (list.length === 0) return [];
	const index = await loadIndex(opts.targetDir);
	const routeFile =
		opts.route && opts.routeSource ? opts.routeSource[opts.route]?.replace(/\\/g, "/") : undefined;
	const matches = new Map<string, SourceMatch>();

	for (const probe of list) {
		const hits: Array<{ file: string; offset: number }> = [];
		for (const [file, text] of index.contents) {
			probe.pattern.lastIndex = 0;
			const m = probe.pattern.exec(text);
			if (m) hits.push({ file, offset: m.index });
			if (hits.length > 50) break;
		}
		if (hits.length === 0) continue;
		const unique = hits.length === 1;
		for (const hit of hits) {
			let score = probe.baseScore;
			if (!unique) score *= hits.length <= 3 ? 0.7 : 0.4;
			if (routeFile && hit.file === routeFile) score = Math.min(1, score + 0.15);
			else if (routeFile && hit.file.startsWith(routeFile.split("/").slice(0, -1).join("/")))
				score = Math.min(1, score + 0.05);
			const text = index.contents.get(hit.file) ?? "";
			const existing = matches.get(hit.file);
			if (existing && existing.score >= score) continue;
			const match: SourceMatch = {
				file: hit.file,
				score: Math.round(score * 100) / 100,
				reason: `${probe.reason}${unique ? " (unique)" : ` (${hits.length} files)`}`,
				line: lineOf(text, hit.offset),
			};
			const symbol = symbolAt(hit.file, text, hit.offset);
			if (symbol) match.symbol = symbol;
			matches.set(hit.file, match);
		}
	}
	return [...matches.values()].sort((a, b) => b.score - a.score || a.file.localeCompare(b.file)).slice(0, 5);
}

/** Build a `FindingLocation`: source file + symbol when a match is good enough, else the DOM fallback. */
export function locationFor(
	match: SourceMatch | undefined,
	fallback: { selector?: string; path?: string },
): FindingLocation {
	const location: FindingLocation = {};
	if (match && match.score >= 0.5) {
		location.file = match.file;
		if (match.symbol) location.symbol = match.symbol;
	}
	if (fallback.selector) location.selector = fallback.selector;
	if (!location.file && !location.selector && fallback.path) location.path = fallback.path;
	return location;
}
