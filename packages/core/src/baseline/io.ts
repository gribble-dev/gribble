import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { ConfigError, describeValidationErrors } from "../config/errors.js";
import { normalizeRoute } from "../report/fingerprint.js";
import type { Report, RouteMetrics } from "../report/schema.js";
import {
	type Baseline,
	type BaselineFinding,
	type BaselineFindingsFile,
	type BaselineMeta,
	type BaselineMetricsFile,
	baselineFindingsFileSchema,
	baselineMetaSchema,
	baselineMetricsFileSchema,
} from "./schema.js";
import { routeSlug } from "./slug.js";

export const BASELINE_DIR = "baseline";

export interface BaselinePaths {
	dir: string;
	findings: string;
	metrics: string;
	meta: string;
	snapshots: string;
	screenshots: string;
}

export function baselinePaths(gribbleDir: string): BaselinePaths {
	const dir = join(gribbleDir, BASELINE_DIR);
	return {
		dir,
		findings: join(dir, "findings.json"),
		metrics: join(dir, "metrics.json"),
		meta: join(dir, "meta.json"),
		snapshots: join(dir, "snapshots"),
		screenshots: join(dir, "screenshots"),
	};
}

export function baselineSnapshotPath(gribbleDir: string, route: string): string {
	return join(baselinePaths(gribbleDir).snapshots, `${routeSlug(route)}.aria.yaml`);
}

/**
 * Screenshots are stored per rendering platform, like Playwright's `toHaveScreenshot` snapshots:
 * `index@desktop.chromium-linux.webp`. Every platform that updates the baseline keeps its own set,
 * so a laptop and CI never compare each other's pixels.
 */
export function screenshotPlatformKey(platform: { os: string; browser: string }): string {
	const browser = (platform.browser.trim().split(/\s+/)[0] ?? "browser").toLowerCase();
	return `${browser}-${platform.os}`;
}

export function baselineScreenshotPath(
	gribbleDir: string,
	route: string,
	viewport: string,
	ext = "webp",
	platformKey?: string,
): string {
	const suffix = platformKey ? `.${platformKey}` : "";
	return join(baselinePaths(gribbleDir).screenshots, `${routeSlug(route)}@${viewport}${suffix}.${ext}`);
}

async function readJsonIfExists<T>(file: string, schema: TSchema): Promise<T | undefined> {
	let text: string;
	try {
		text = await readFile(file, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw err;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (err) {
		throw new ConfigError(`invalid JSON: ${(err as Error).message}`, { file });
	}
	if (!Value.Check(schema, parsed)) {
		const { path, message } = describeValidationErrors(Value.Errors(schema, parsed));
		throw new ConfigError(message, { file, path });
	}
	return parsed as T;
}

/** Read `.gribble/baseline/`. Returns undefined when no baseline file exists. */
export async function readBaseline(gribbleDir: string): Promise<Baseline | undefined> {
	const paths = baselinePaths(gribbleDir);
	const [findings, metrics, meta] = await Promise.all([
		readJsonIfExists<BaselineFindingsFile>(paths.findings, baselineFindingsFileSchema),
		readJsonIfExists<BaselineMetricsFile>(paths.metrics, baselineMetricsFileSchema),
		readJsonIfExists<BaselineMeta>(paths.meta, baselineMetaSchema),
	]);
	if (!findings && !metrics && !meta) return undefined;
	return {
		meta: meta ?? { version: 1, at: "", gribbleVersion: "", viewports: {} },
		findings: findings?.findings ?? [],
		metrics: metrics?.routes ?? {},
	};
}

function imageExtension(bytes: Uint8Array): string {
	if (
		bytes.length >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[8] === 0x57
	) {
		return "webp";
	}
	if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
		return "png";
	}
	return "png";
}

export interface WriteBaselineInput {
	report: Report;
	/** Route -> aria snapshot YAML. */
	snapshots?: Record<string, string>;
	/** `<route>@<viewport>` -> encoded image (webp or png). */
	screenshots?: Record<string, Uint8Array>;
	/** When given, baseline findings and metrics for routes outside this list are kept as they were. */
	auditedRoutes?: string[];
	/** Viewport configuration to record in meta.json; falls back to the previous baseline's. */
	viewports?: Record<string, { width: number; height: number }>;
	/** Rendering platform of the screenshots; becomes part of their file names. */
	platform?: { os: string; arch: string; browser: string };
	/** `lfs` writes a .gitattributes so screenshots go through Git LFS. */
	screenshotsMode?: "commit" | "lfs" | "off";
}

/** Contents of baseline/.gitattributes when screenshots are stored in Git LFS. */
export const LFS_GITATTRIBUTES = "screenshots/** filter=lfs diff=lfs merge=lfs -text\n";

/**
 * Write the baseline from a report. Findings become the ledger (`firstSeen` is preserved for
 * fingerprints already known), route metrics are merged, snapshots and screenshots are written by slug.
 */
export async function writeBaseline(gribbleDir: string, data: WriteBaselineInput): Promise<void> {
	const paths = baselinePaths(gribbleDir);
	const previous = await readBaseline(gribbleDir);
	const { report } = data;
	const audited = data.auditedRoutes ? new Set(data.auditedRoutes.map(normalizeRoute)) : undefined;
	const previousByFp = new Map((previous?.findings ?? []).map((f) => [f.fingerprint, f]));

	const ledger = new Map<string, BaselineFinding>();
	if (audited) {
		for (const f of previous?.findings ?? []) {
			if (!audited.has(normalizeRoute(f.route))) ledger.set(f.fingerprint, f);
		}
	}
	for (const finding of report.findings) {
		if (finding.status === "fixed") continue;
		const known = previousByFp.get(finding.fingerprint);
		const entry: BaselineFinding = {
			fingerprint: finding.fingerprint,
			rule: finding.rule,
			severity: finding.severity,
			route: finding.route,
			firstSeen: known?.firstSeen ?? { commit: report.repo?.commit, at: report.generatedAt },
		};
		if (finding.location) entry.location = finding.location;
		if (finding.subject !== undefined) entry.subject = finding.subject;
		if (entry.firstSeen.commit === undefined) delete entry.firstSeen.commit;
		ledger.set(finding.fingerprint, entry);
	}
	const findingsFile: BaselineFindingsFile = {
		version: 1,
		findings: [...ledger.values()].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)),
	};

	const routes: Record<string, RouteMetrics> = {};
	for (const [route, metrics] of Object.entries(previous?.metrics ?? {})) {
		if (!audited?.has(normalizeRoute(route))) routes[route] = metrics;
	}
	for (const result of report.routes) {
		if (result.metrics) routes[result.route] = result.metrics;
	}
	const metricsFile: BaselineMetricsFile = { version: 1, routes };

	const meta: BaselineMeta = {
		version: 1,
		at: report.generatedAt,
		gribbleVersion: report.gribbleVersion,
		viewports: data.viewports ?? previous?.meta.viewports ?? {},
	};
	if (report.repo?.commit) meta.commit = report.repo.commit;
	if (report.repo?.branch) meta.branch = report.repo.branch;
	if (report.model) meta.model = report.model;

	await mkdir(paths.dir, { recursive: true });
	await writeFile(paths.findings, `${JSON.stringify(findingsFile, null, 2)}\n`, "utf8");
	await writeFile(paths.metrics, `${JSON.stringify(metricsFile, null, 2)}\n`, "utf8");
	await writeFile(paths.meta, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

	if (data.snapshots && Object.keys(data.snapshots).length > 0) {
		await mkdir(paths.snapshots, { recursive: true });
		for (const [route, yaml] of Object.entries(data.snapshots)) {
			await writeFile(
				baselineSnapshotPath(gribbleDir, route),
				yaml.endsWith("\n") ? yaml : `${yaml}\n`,
				"utf8",
			);
		}
	}
	if (data.screenshots && Object.keys(data.screenshots).length > 0) {
		await mkdir(paths.screenshots, { recursive: true });
		if (data.screenshotsMode === "lfs") {
			await writeFile(join(paths.dir, ".gitattributes"), LFS_GITATTRIBUTES, "utf8");
		}
		for (const [key, bytes] of Object.entries(data.screenshots)) {
			const at = key.lastIndexOf("@");
			const route = at === -1 ? key : key.slice(0, at);
			const viewport = at === -1 ? "default" : key.slice(at + 1);
			const platformKey = data.platform ? screenshotPlatformKey(data.platform) : undefined;
			await writeFile(
				baselineScreenshotPath(gribbleDir, route, viewport, imageExtension(bytes), platformKey),
				bytes,
			);
		}
	}
}
