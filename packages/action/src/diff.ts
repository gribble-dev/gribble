/**
 * Helpers for mapping findings onto the pull request diff.
 */

/**
 * Right-hand (new file) line numbers covered by a unified diff `patch`, i.e.
 * the lines GitHub accepts for a line-anchored review comment.
 */
export function parseDiffLines(patch: string | undefined): Set<number> {
	const lines = new Set<number>();
	if (!patch) return lines;
	let current = 0;
	for (const raw of patch.split("\n")) {
		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(raw);
		if (hunk) {
			current = Number(hunk[1]);
			continue;
		}
		if (raw.startsWith("+")) {
			lines.add(current);
			current += 1;
		} else if (raw.startsWith("-") || raw.startsWith("\\")) {
			// removed line or "\ No newline at end of file": no right-hand line
		} else {
			lines.add(current);
			current += 1;
		}
	}
	return lines;
}

export interface DiffFile {
	/** Path relative to the repository root, as GitHub reports it. */
	path: string;
	/** Right-hand lines present in the diff. */
	lines: Set<number>;
}

export function toDiffIndex(
	files: Array<{ filename: string; patch?: string; status?: string }>,
): Map<string, DiffFile> {
	const index = new Map<string, DiffFile>();
	for (const f of files) {
		if (f.status === "removed") continue;
		index.set(normalizePath(f.filename), { path: normalizePath(f.filename), lines: parseDiffLines(f.patch) });
	}
	return index;
}

export function normalizePath(p: string): string {
	return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}
