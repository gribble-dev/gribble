/**
 * Baseline comparisons: perf/regression (metrics), visual/regression (pixelmatch),
 * structure/regression (aria snapshot landmarks, navigation, forms, headings).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { baselinePaths } from "../baseline/io.js";
import { routeSlug } from "../baseline/slug.js";
import type { Finding } from "../report/schema.js";
import { makeFinding, ruleEnabled, ruleOptions } from "./finding.js";
import type { RegressionOptions } from "./types.js";

interface RawImage {
	data: Buffer;
	width: number;
	height: number;
}

async function decode(bytes: Buffer): Promise<RawImage> {
	try {
		const { default: sharp } = await import("sharp");
		const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
		return { data, width: info.width, height: info.height };
	} catch {
		const { PNG } = await import("pngjs");
		const png = PNG.sync.read(bytes);
		return { data: png.data, width: png.width, height: png.height };
	}
}

function crop(img: RawImage, width: number, height: number): Buffer {
	if (img.width === width && img.height === height) return img.data;
	const out = Buffer.alloc(width * height * 4);
	for (let y = 0; y < height; y++) {
		img.data.copy(out, y * width * 4, y * img.width * 4, y * img.width * 4 + width * 4);
	}
	return out;
}

/** Encode a PNG screenshot as webp for the baseline; falls back to the PNG bytes. */
export async function encodeBaselineScreenshot(png: Buffer): Promise<Buffer> {
	try {
		const { default: sharp } = await import("sharp");
		return await sharp(png).webp({ quality: 80 }).toBuffer();
	} catch {
		return png;
	}
}

export interface VisualDiff {
	mismatchRatio: number;
	changedPixels: number;
	width: number;
	height: number;
	sizeChanged: boolean;
	diffPng?: Buffer;
}

/** Compare two encoded images; the diff is rendered over the common area. */
export async function compareScreenshots(current: Buffer, baseline: Buffer): Promise<VisualDiff> {
	const [a, b] = await Promise.all([decode(current), decode(baseline)]);
	const width = Math.min(a.width, b.width);
	const height = Math.min(a.height, b.height);
	const { default: pixelmatch } = await import("pixelmatch");
	const { PNG } = await import("pngjs");
	const diff = new PNG({ width, height });
	const changed = pixelmatch(crop(a, width, height), crop(b, width, height), diff.data, width, height, {
		threshold: 0.1,
		includeAA: true,
	});
	const total = Math.max(a.width * a.height, b.width * b.height);
	const sizeChanged = a.width !== b.width || a.height !== b.height;
	const extra = total - width * height;
	return {
		mismatchRatio: total === 0 ? 0 : (changed + extra) / total,
		changedPixels: changed + extra,
		width,
		height,
		sizeChanged,
		diffPng: PNG.sync.write(diff),
	};
}

const STRUCTURE_LINE =
	/^\s*-\s*(navigation|main|banner|contentinfo|form|search|complementary|region|heading|dialog|table|list)\b(.*)$/;

/** Structural keys of an aria snapshot: landmarks, navigation, forms and headings, with their names. */
export function structureKeys(aria: string): Map<string, number> {
	const keys = new Map<string, number>();
	for (const line of aria.split(/\r?\n/)) {
		const m = line.match(STRUCTURE_LINE);
		if (!m) continue;
		const name = m[2]!
			.replace(/\s*:\s*$/, "")
			.replace(/\[level=\d+\]/, "")
			.trim();
		const key = name ? `${m[1]} ${name}` : m[1]!;
		keys.set(key, (keys.get(key) ?? 0) + 1);
	}
	return keys;
}

async function readIfExists(file: string): Promise<Buffer | undefined> {
	try {
		return await readFile(file);
	} catch {
		return undefined;
	}
}

/** perf/regression, visual/regression, structure/regression against the baseline. */
export async function checkRegressions(opts: RegressionOptions): Promise<Finding[]> {
	const out: Finding[] = [];
	const { project, targetName, baseline, perRoute } = opts;
	if (!baseline) return out;
	const paths = baselinePaths(project.gribbleDir);
	const emit = (
		route: string,
		viewport: string | null,
		rule: string,
		input: Parameters<typeof makeFinding>[2],
	) => {
		const finding = makeFinding({ project, route, targetName, viewport: viewport ?? "" }, rule, {
			...input,
			viewport,
		});
		if (!finding) return;
		out.push(finding);
		opts.onEvent?.({ type: "finding", finding });
	};

	for (const route of opts.routes) {
		const result = perRoute.get(route);
		if (!result) continue;
		const ctx = { project, route };

		// perf/regression
		if (ruleEnabled(ctx, "perf/regression")) {
			const before = baseline.metrics[route];
			const after = result.metrics;
			if (before && after) {
				const thresholds = ruleOptions<{ score: number; lcpMs: number; cls: number; weightKb: number }>(
					ctx,
					"perf/regression",
				);
				const checks: Array<{
					key: string;
					label: string;
					before?: number;
					after?: number;
					bad: boolean;
					unit: string;
				}> = [
					{
						key: "score",
						label: "Lighthouse performance score",
						before: before.lighthousePerformance,
						after: after.lighthousePerformance,
						unit: "",
						bad:
							before.lighthousePerformance !== undefined &&
							after.lighthousePerformance !== undefined &&
							after.lighthousePerformance - before.lighthousePerformance < (thresholds.score ?? -5),
					},
					{
						key: "lcp",
						label: "LCP",
						before: before.lcpMs,
						after: after.lcpMs,
						unit: " ms",
						bad:
							before.lcpMs !== undefined &&
							after.lcpMs !== undefined &&
							after.lcpMs - before.lcpMs > (thresholds.lcpMs ?? 500),
					},
					{
						key: "cls",
						label: "CLS",
						before: before.cls,
						after: after.cls,
						unit: "",
						bad:
							before.cls !== undefined &&
							after.cls !== undefined &&
							after.cls - before.cls > (thresholds.cls ?? 0.05),
					},
					{
						key: "weight",
						label: "page weight",
						before: before.pageWeightKb,
						after: after.pageWeightKb,
						unit: " KB",
						bad:
							before.pageWeightKb !== undefined &&
							after.pageWeightKb !== undefined &&
							after.pageWeightKb - before.pageWeightKb > (thresholds.weightKb ?? 300),
					},
				];
				for (const c of checks) {
					if (!c.bad) continue;
					emit(route, null, "perf/regression", {
						title: `${c.label} regressed on ${route}: ${c.before}${c.unit} → ${c.after}${c.unit}`,
						message: `Baseline ${c.label} was ${c.before}${c.unit}; this run measured ${c.after}${c.unit}.`,
						subject: c.key,
						evidence: { data: { before: c.before, after: c.after } },
					});
				}
			}
		}

		// visual/regression
		if (ruleEnabled(ctx, "visual/regression") && project.config.baseline.screenshots !== "off") {
			const { threshold, viewports } = ruleOptions<{ threshold: number; viewports: string[] }>(
				ctx,
				"visual/regression",
			);
			for (const viewport of viewports ?? []) {
				const current = opts.screenshots.get(`${route}@${viewport}`);
				if (!current) continue;
				const slug = routeSlug(route);
				const previous =
					(await readIfExists(join(paths.screenshots, `${slug}@${viewport}.webp`))) ??
					(await readIfExists(join(paths.screenshots, `${slug}@${viewport}.png`)));
				if (!previous) continue;
				let diff: VisualDiff;
				try {
					diff = await compareScreenshots(current, previous);
				} catch (err) {
					opts.onEvent?.({
						type: "log",
						level: "warn",
						message: `visual/regression skipped for ${route}@${viewport}: ${(err as Error).message}`,
					});
					continue;
				}
				if (diff.mismatchRatio <= (threshold ?? 0.01)) continue;
				let diffPath: string | undefined;
				if (diff.diffPng) {
					const dir = join(opts.runDir, "diffs");
					await mkdir(dir, { recursive: true });
					const file = join(dir, `${slug}@${viewport}.png`);
					await writeFile(file, diff.diffPng);
					diffPath = relative(opts.runDir, file).replace(/\\/g, "/");
				}
				emit(route, viewport, "visual/regression", {
					title: `${route} changed visually in the ${viewport} viewport (${(diff.mismatchRatio * 100).toFixed(1)}% of pixels)`,
					message: `${diff.changedPixels} pixels differ from the baseline screenshot${diff.sizeChanged ? " and the page size changed" : ""}; the threshold is ${((threshold ?? 0.01) * 100).toFixed(1)}%.`,
					subject: viewport,
					evidence: {
						screenshot: diffPath,
						data: { mismatchRatio: diff.mismatchRatio, sizeChanged: diff.sizeChanged },
					},
				});
			}
		}

		// structure/regression
		if (ruleEnabled(ctx, "structure/regression") && result.ariaSnapshot) {
			const previous = await readIfExists(join(paths.snapshots, `${routeSlug(route)}.aria.yaml`));
			if (!previous) continue;
			const before = structureKeys(previous.toString("utf8"));
			const after = structureKeys(result.ariaSnapshot);
			let reported = 0;
			for (const [key, count] of before) {
				if ((after.get(key) ?? 0) >= count) continue;
				if (reported++ >= 10) break;
				const kind = key.match(/^[a-z]+/)?.[0] ?? "element";
				const name = key.slice(kind.length).trim();
				emit(route, null, "structure/regression", {
					title: `${kind}${name ? ` ${name}` : ""} disappeared from ${route}`,
					message: `The baseline aria snapshot has ${count} ${kind}${name ? ` ${name}` : ""} entr${count === 1 ? "y" : "ies"}; this run has ${after.get(key) ?? 0}.`,
					subject: key,
					location: { path: key },
				});
			}
		}
	}
	return out;
}
