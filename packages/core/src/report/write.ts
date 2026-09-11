import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Report } from "./schema.js";

export const RUNS_DIR = "runs";
export const LATEST_REPORT_FILE = "latest.json";
export const RUN_REPORT_FILE = "report.json";

const RUN_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

/** `2026-09-11T10:20:30.123Z` -> `2026-09-11T10-20-30-123Z`, safe on every filesystem. */
export function runDirName(isoTimestamp: string): string {
	return isoTimestamp.replace(/[:.]/g, "-");
}

/**
 * Write `runs/<timestamp>/report.json` and `runs/latest.json` under `gribbleDir` (or `opts.runsDir`),
 * then delete the oldest run directories beyond `opts.keep` (default 10).
 */
export async function writeRunReport(
	gribbleDir: string,
	report: Report,
	opts: { keep?: number; runsDir?: string } = {},
): Promise<{ dir: string; jsonPath: string; latestPath: string }> {
	const runsDir = opts.runsDir ?? join(gribbleDir, RUNS_DIR);
	const dir = join(runsDir, runDirName(report.generatedAt));
	await mkdir(dir, { recursive: true });
	const json = `${JSON.stringify(report, null, 2)}\n`;
	const jsonPath = join(dir, RUN_REPORT_FILE);
	const latestPath = join(runsDir, LATEST_REPORT_FILE);
	await writeFile(jsonPath, json, "utf8");
	await writeFile(latestPath, json, "utf8");
	await pruneRuns(runsDir, opts.keep ?? 10);
	return { dir, jsonPath, latestPath };
}

/** Delete run directories beyond the newest `keep`. */
export async function pruneRuns(runsDir: string, keep: number): Promise<string[]> {
	const entries = await readdir(runsDir, { withFileTypes: true });
	const runs = entries
		.filter((e) => e.isDirectory() && RUN_DIR_PATTERN.test(e.name))
		.map((e) => e.name)
		.sort()
		.reverse();
	const stale = runs.slice(Math.max(keep, 0));
	for (const name of stale) await rm(join(runsDir, name), { recursive: true, force: true });
	return stale;
}
