import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { minimatch } from "minimatch";

const PROBES = [".gribble", "apps/web/.gribble"];

/** True when a pattern from a .gitignore would ignore the whole `.gribble` directory. */
export function gitignorePatternIgnoresGribbleDir(pattern: string): boolean {
	const line = pattern.trim();
	if (!line || line.startsWith("#") || line.startsWith("!")) return false;
	let normalized = line.replace(/\/+$/, "");
	const anchored = normalized.startsWith("/");
	if (anchored) normalized = normalized.slice(1);
	if (normalized === ".gribble" || normalized === ".gribble/**" || normalized === "**/.gribble") return true;
	const candidates = anchored || normalized.includes("/") ? [normalized] : [normalized, `**/${normalized}`];
	return PROBES.some((probe) =>
		candidates.some((candidate) =>
			minimatch(probe, candidate, { dot: true, matchBase: !candidate.includes("/") }),
		),
	);
}

/**
 * True when the root .gitignore ignores the whole `.gribble/` directory, which would also drop the
 * rules, flows and baseline that are meant to be committed. Missing file -> false.
 */
export async function detectRootGitignoreConflict(repoRoot: string): Promise<boolean> {
	let text: string;
	try {
		text = await readFile(join(repoRoot, ".gitignore"), "utf8");
	} catch {
		return false;
	}
	return text.split(/\r?\n/).some(gitignorePatternIgnoresGribbleDir);
}
