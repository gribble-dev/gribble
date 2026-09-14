/**
 * Visual pack: compare the current viewport with the baseline screenshot. Pixel diffing is done
 * in code; the model gets a ratio and a diff image path, never the pixels.
 */
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import sharp from "sharp";
import { Type } from "typebox";
import { baselineScreenshotPath, routeSlug, screenshotPlatformKey } from "../../baseline/index.js";
import { encodeBaselineScreenshot } from "../../checks/regressions.js";
import { VISUAL_TOOLS } from "../names.js";
import type { AgentState } from "../state.js";
import { textResult } from "./common.js";

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function findBaselineScreenshot(
	gribbleDir: string,
	route: string,
	viewport: string,
	platformKey: string,
): Promise<string | undefined> {
	for (const ext of ["webp", "png"]) {
		const path = baselineScreenshotPath(gribbleDir, route, viewport, ext, platformKey);
		if (await exists(path)) return path;
	}
	return undefined;
}

interface Raw {
	data: Buffer;
	width: number;
	height: number;
}

async function toRaw(input: Buffer | string, size?: { width: number; height: number }): Promise<Raw> {
	let pipeline = sharp(input).ensureAlpha();
	if (size) pipeline = pipeline.resize(size.width, size.height, { fit: "fill" });
	const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
	return { data, width: info.width, height: info.height };
}

/** Compare two images; returns the ratio of differing pixels and a PNG diff. */
export async function diffImages(
	current: Buffer,
	baseline: Buffer | string,
): Promise<{ ratio: number; diffPng: Buffer; width: number; height: number }> {
	const a = await toRaw(current);
	const b = await toRaw(baseline, { width: a.width, height: a.height });
	const diff = new PNG({ width: a.width, height: a.height });
	const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
	return {
		ratio: changed / (a.width * a.height),
		diffPng: PNG.sync.write(diff),
		width: a.width,
		height: a.height,
	};
}

export function visualPack(state: AgentState): InlineExtension {
	return {
		name: "gribble-visual",
		factory: (pi: ExtensionAPI) => {
			pi.registerTool({
				name: VISUAL_TOOLS.compareScreenshot,
				label: "Compare screenshot",
				description:
					"Compare the current viewport with the baseline screenshot of this route and viewport. Returns the ratio of changed pixels and writes a diff image to the run directory. Reports no difference when the baseline has no screenshot.",
				parameters: Type.Object({
					route: Type.Optional(Type.String({ description: "Route to compare; default the current route." })),
				}),
				async execute(_id, params, _signal, onUpdate) {
					const page = await state.currentPage();
					const route = params.route ?? state.trackUrl(page.url());
					const platformKey = screenshotPlatformKey({
						os: process.platform,
						browser: state.browser.version(),
					});
					const baseline = await findBaselineScreenshot(
						state.project.gribbleDir,
						route,
						page.viewport,
						platformKey,
					);
					if (!baseline) {
						return textResult(`No baseline screenshot for ${route}@${page.viewport}; nothing to compare.`, {
							route,
							viewport: page.viewport,
							baseline: undefined,
							ratio: 0,
						});
					}
					onUpdate?.({ content: [{ type: "text", text: "Comparing pixels…" }], details: {} });
					const current = await page.screenshot({ fullPage: false });
					const { ratio, diffPng, width, height } = await diffImages(
						await encodeBaselineScreenshot(current),
						baseline,
					);
					const dir = join(state.runDir, "diffs");
					await mkdir(dir, { recursive: true });
					const diffPath = join(dir, `${routeSlug(route)}@${page.viewport}.diff.png`);
					await writeFile(diffPath, diffPng);
					const threshold = state.project.rules.get("visual/regression", route).options.threshold;
					const percent = (ratio * 100).toFixed(2);
					const verdict =
						typeof threshold === "number"
							? ratio > threshold
								? `above the ${threshold} threshold`
								: `within the ${threshold} threshold`
							: "";
					return textResult(
						`${percent}% of pixels differ from the baseline for ${route}@${page.viewport} (${width}x${height}) ${verdict}. Diff: ${diffPath}`,
						{ route, viewport: page.viewport, baseline, ratio, diffPath, threshold },
					);
				},
			});
		},
	};
}
