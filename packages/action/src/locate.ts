/**
 * Resolve a finding's `location.file` to a repository-relative path and a line.
 * Findings carry file + symbol (never a line number), so the line is found by a
 * plain text search for the symbol; failing that, line 1.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { normalizePath } from "./diff.js";
import type { Finding } from "./types.js";

export interface LocateOptions {
	/** Absolute repository root (GITHUB_WORKSPACE). Annotation paths are relative to it. */
	repoRoot: string;
	/** Absolute directories to try, in order, when the file is not repo-root relative. */
	searchRoots?: string[];
	/** Injectable for tests. */
	readFile?: (absolutePath: string) => string | undefined;
}

export interface ResolvedLocation {
	/** Repository-relative POSIX path. */
	path: string;
	line: number;
	/** Whether the symbol was found in the file (false: line 1 fallback). */
	symbolFound: boolean;
}

function defaultReadFile(absolutePath: string): string | undefined {
	try {
		if (!existsSync(absolutePath)) return undefined;
		return readFileSync(absolutePath, "utf8");
	} catch {
		return undefined;
	}
}

/** 1-based line of the first occurrence of `symbol` in `content`; 1 when absent. */
export function resolveLine(
	content: string | undefined,
	symbol: string | undefined,
): { line: number; found: boolean } {
	if (!content || !symbol) return { line: 1, found: false };
	const needle = symbol.trim();
	if (!needle) return { line: 1, found: false };
	const lines = content.split(/\r?\n/);
	// Prefer whole-word matches so `Button` does not land on `ButtonGroup`.
	const word = new RegExp(`(^|[^A-Za-z0-9_$])${escapeRegExp(needle)}($|[^A-Za-z0-9_$])`);
	for (let i = 0; i < lines.length; i += 1) {
		if (word.test(lines[i] ?? "")) return { line: i + 1, found: true };
	}
	for (let i = 0; i < lines.length; i += 1) {
		if ((lines[i] ?? "").includes(needle)) return { line: i + 1, found: true };
	}
	return { line: 1, found: false };
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find the file on disk. `location.file` is expected to be repository-root
 * relative; target-directory relative paths are also accepted.
 */
export function locateFinding(finding: Finding, opts: LocateOptions): ResolvedLocation | undefined {
	const file = finding.location?.file;
	if (!file) return undefined;
	const readFile = opts.readFile ?? defaultReadFile;
	const rel = normalizePath(file);
	const candidates: string[] = [];
	if (path.isAbsolute(file)) candidates.push(file);
	candidates.push(path.join(opts.repoRoot, rel));
	for (const root of opts.searchRoots ?? []) candidates.push(path.join(root, rel));

	for (const candidate of candidates) {
		const content = readFile(candidate);
		if (content === undefined) continue;
		const relative = normalizePath(path.relative(opts.repoRoot, candidate));
		if (relative.startsWith("../")) continue;
		const { line, found } = resolveLine(content, finding.location?.symbol);
		return { path: relative, line, symbolFound: found };
	}
	// Unknown on disk: keep the path so the summary can still name it.
	return { path: rel, line: 1, symbolFound: false };
}
