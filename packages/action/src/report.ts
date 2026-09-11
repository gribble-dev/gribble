import { promises as fs } from "node:fs";
import path from "node:path";
import type { Finding, LoadedReport, Report } from "./types.js";

export class ReportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ReportError";
	}
}

const SEVERITIES = new Set(["critical", "error", "warn", "info"]);
const STATUSES = new Set(["new", "existing", "fixed"]);

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate the minimal shape the action relies on; fills harmless defaults. */
export function validateReport(raw: unknown, source = "report"): Report {
	if (!isObject(raw)) throw new ReportError(`${source}: expected a JSON object`);
	if (raw.version !== 1)
		throw new ReportError(`${source}: unsupported report version ${String(raw.version)} (expected 1)`);
	if (!isObject(raw.summary)) throw new ReportError(`${source}: missing summary`);
	if (raw.summary.gate !== "pass" && raw.summary.gate !== "fail") {
		throw new ReportError(`${source}: summary.gate must be "pass" or "fail"`);
	}
	if (!Array.isArray(raw.findings)) throw new ReportError(`${source}: findings must be an array`);
	if (!isObject(raw.target) || typeof raw.target.url !== "string") {
		throw new ReportError(`${source}: target.url is required`);
	}
	const findings: Finding[] = raw.findings.map((f, i) => {
		if (!isObject(f)) throw new ReportError(`${source}: findings[${i}] is not an object`);
		for (const key of ["fingerprint", "rule", "title", "route"]) {
			if (typeof f[key] !== "string")
				throw new ReportError(`${source}: findings[${i}].${key} must be a string`);
		}
		if (!SEVERITIES.has(String(f.severity)))
			throw new ReportError(`${source}: findings[${i}].severity is invalid`);
		if (!STATUSES.has(String(f.status))) throw new ReportError(`${source}: findings[${i}].status is invalid`);
		const finding = f as unknown as Finding;
		return {
			...finding,
			message: typeof finding.message === "string" ? finding.message : "",
			source: finding.source === "ai" ? "ai" : "deterministic",
			docsUrl:
				typeof finding.docsUrl === "string" ? finding.docsUrl : `https://gribble.dev/rules/${finding.rule}`,
		};
	});
	const counts = isObject(raw.summary.counts) ? raw.summary.counts : {};
	const summary = raw.summary;
	const gate: "pass" | "fail" = summary.gate === "pass" ? "pass" : "fail";
	const rawBaseline = isObject(raw.baseline) ? raw.baseline : {};
	const report: Report = {
		...(raw as unknown as Report),
		gribbleVersion: typeof raw.gribbleVersion === "string" ? raw.gribbleVersion : "unknown",
		generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : new Date().toISOString(),
		mode: raw.mode === "gate" || raw.mode === "review" ? raw.mode : "all",
		target: {
			...(raw.target as Report["target"]),
			name: typeof raw.target.name === "string" ? raw.target.name : "",
		},
		baseline: {
			...(rawBaseline as Partial<Report["baseline"]>),
			present: Boolean(rawBaseline.present),
			bootstrap: Boolean(rawBaseline.bootstrap),
		},
		budget: isObject(raw.budget)
			? (raw.budget as Report["budget"])
			: { steps: 0, maxSteps: 0, tokens: 0, maxTokens: 0, costUsd: 0 },
		summary: {
			counts: {
				critical: Number(counts.critical ?? 0),
				error: Number(counts.error ?? 0),
				warn: Number(counts.warn ?? 0),
				info: Number(counts.info ?? 0),
			},
			newCount: Number(summary.newCount ?? findings.filter((f) => f.status === "new").length),
			existingCount: Number(summary.existingCount ?? findings.filter((f) => f.status === "existing").length),
			fixedCount: Number(summary.fixedCount ?? findings.filter((f) => f.status === "fixed").length),
			gate,
			headline: typeof summary.headline === "string" ? summary.headline : "",
		},
		findings,
		routes: Array.isArray(raw.routes) ? (raw.routes as Report["routes"]) : [],
		flows: Array.isArray(raw.flows) ? (raw.flows as Report["flows"]) : [],
		durationMs: typeof raw.durationMs === "number" ? raw.durationMs : 0,
	};
	return report;
}

export function parseReportJson(text: string, source = "report"): Report {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new ReportError(
			`${source}: invalid JSON (${error instanceof Error ? error.message : String(error)})`,
		);
	}
	return validateReport(parsed, source);
}

/** Read `<gribbleDir>/runs/latest.json`. */
export async function loadLatestReport(gribbleDir: string): Promise<LoadedReport> {
	const file = path.join(gribbleDir, "runs", "latest.json");
	const text = await fs.readFile(file, "utf8");
	return {
		report: parseReportJson(text, path.relative(process.cwd(), file) || file),
		path: file,
		gribbleDir,
		targetDir: path.dirname(gribbleDir),
	};
}

/**
 * Newest `runs/<timestamp>/` directory next to latest.json, i.e. the run
 * directory holding screenshots and snapshots for the latest report.
 */
export async function findLatestRunDir(gribbleDir: string): Promise<string | undefined> {
	const runsDir = path.join(gribbleDir, "runs");
	let entries: import("node:fs").Dirent[];
	try {
		entries = await fs.readdir(runsDir, { withFileTypes: true });
	} catch {
		return undefined;
	}
	const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
	if (dirs.length === 0) return undefined;
	let best: { name: string; mtime: number } | undefined;
	for (const name of dirs) {
		const stat = await fs.stat(path.join(runsDir, name));
		if (!best || stat.mtimeMs > best.mtime || (stat.mtimeMs === best.mtime && name > best.name)) {
			best = { name, mtime: stat.mtimeMs };
		}
	}
	return best ? path.join(runsDir, best.name) : undefined;
}

const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	".svelte-kit",
	".output",
	"coverage",
]);

/** All `.gribble` directories under `root` (for `--all`), depth-limited. */
export async function findGribbleDirs(root: string, maxDepth = 6): Promise<string[]> {
	const found: string[] = [];
	async function walk(dir: string, depth: number): Promise<void> {
		let entries: import("node:fs").Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (!e.isDirectory()) continue;
			if (e.name === ".gribble") {
				found.push(path.join(dir, e.name));
				continue;
			}
			if (SKIP_DIRS.has(e.name) || (e.name.startsWith(".") && e.name !== ".gribble")) continue;
			if (depth < maxDepth) await walk(path.join(dir, e.name), depth + 1);
		}
	}
	await walk(root, 0);
	return found.sort();
}
