import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Baseline, RouteCheckResult } from "../src/index.js";
import { checkRegressions, compareScreenshots, encodeBaselineScreenshot } from "../src/index.js";
import { makeProject } from "./browser-helpers.js";

function png(
	width: number,
	height: number,
	paint: (x: number, y: number) => [number, number, number],
): Buffer {
	const image = new PNG({ width, height });
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const [r, g, b] = paint(x, y);
			image.data[i] = r;
			image.data[i + 1] = g;
			image.data[i + 2] = b;
			image.data[i + 3] = 255;
		}
	}
	return PNG.sync.write(image);
}

const white = png(100, 80, () => [255, 255, 255]);
const halfBlack = png(100, 80, (x) => (x < 50 ? [0, 0, 0] : [255, 255, 255]));

describe("compareScreenshots", () => {
	it("measures the changed pixel ratio and renders a diff", async () => {
		const same = await compareScreenshots(white, white);
		expect(same.mismatchRatio).toBe(0);
		const diff = await compareScreenshots(halfBlack, white);
		expect(diff.mismatchRatio).toBeCloseTo(0.5, 2);
		expect(diff.sizeChanged).toBe(false);
		expect(diff.diffPng?.length).toBeGreaterThan(0);
	});

	it("accepts webp baselines and counts size changes as differences", async () => {
		const webp = await encodeBaselineScreenshot(white);
		expect(webp.subarray(0, 4).toString()).toBe("RIFF");
		const diff = await compareScreenshots(
			png(100, 100, () => [255, 255, 255]),
			webp,
		);
		expect(diff.sizeChanged).toBe(true);
		expect(diff.mismatchRatio).toBeCloseTo(0.2, 2);
	});
});

describe("checkRegressions", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "gribble-regress-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("reports perf, visual and structure regressions against the baseline", async () => {
		const project = await makeProject({
			url: "http://localhost:3000",
			targetDir: dir,
			gribbleYamlExtra: "baseline:\n  screenshots: commit\n",
			rulesYaml:
				"rules:\n  perf/regression: warn\n  visual/regression: [warn, { threshold: 0.01, viewports: [desktop] }]\n  structure/regression: warn\n",
		});
		const baselineDir = join(project.gribbleDir, "baseline");
		await mkdir(join(baselineDir, "screenshots"), { recursive: true });
		await mkdir(join(baselineDir, "snapshots"), { recursive: true });
		await writeFile(
			join(baselineDir, "screenshots", `index@desktop.chromium-${process.platform}.webp`),
			await encodeBaselineScreenshot(white),
		);
		await writeFile(
			join(baselineDir, "snapshots", "index.aria.yaml"),
			'- navigation "Main":\n  - link "Home"\n- main:\n  - form "Newsletter"\n  - heading "Welcome" [level=1]\n',
		);
		const baseline: Baseline = {
			meta: { version: 1, at: "", gribbleVersion: "0", viewports: {} },
			findings: [],
			metrics: { "/": { lighthousePerformance: 90, lcpMs: 1000, cls: 0.01, pageWeightKb: 500 } },
		};
		const perRoute = new Map<string, RouteCheckResult>([
			[
				"/",
				{
					findings: [],
					metrics: { lighthousePerformance: 70, lcpMs: 1200, cls: 0.2, pageWeightKb: 600 },
					ariaSnapshot: '- navigation "Main":\n  - link "Home"\n- main:\n  - heading "Welcome" [level=1]\n',
				},
			],
		]);
		const runDir = join(dir, "run");
		const findings = await checkRegressions({
			project,
			targetName: "",
			routes: ["/"],
			perRoute,
			baseline,
			screenshots: new Map([["/@desktop", halfBlack]]),
			baselineDir,
			runDir,
		});
		const perf = findings.filter((f) => f.rule === "perf/regression").map((f) => f.subject);
		expect(perf.sort()).toEqual(["cls", "score"]);
		const visual = findings.find((f) => f.rule === "visual/regression");
		expect(visual?.viewport).toBe("desktop");
		expect(visual?.evidence?.screenshot).toBe("diffs/index@desktop.png");
		expect((await readFile(join(runDir, "diffs", "index@desktop.png"))).length).toBeGreaterThan(0);
		const structure = findings.find((f) => f.rule === "structure/regression");
		expect(structure?.subject).toBe('form "Newsletter"');
		expect(structure?.title).toContain("disappeared");
		expect(findings.every((f) => f.route === "/" && f.status === "new")).toBe(true);
	});

	it("does nothing without a baseline", async () => {
		const project = await makeProject({ url: "http://localhost:3000", targetDir: dir });
		const findings = await checkRegressions({
			project,
			targetName: "",
			routes: ["/"],
			perRoute: new Map(),
			baseline: undefined,
			screenshots: new Map(),
			baselineDir: join(dir, "baseline"),
			runDir: join(dir, "run"),
		});
		expect(findings).toEqual([]);
	});
});
