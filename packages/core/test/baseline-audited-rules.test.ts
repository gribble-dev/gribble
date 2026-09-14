import { describe, expect, it } from "vitest";
import { diffAgainstBaseline } from "../src/baseline/diff.js";
import type { Baseline } from "../src/baseline/schema.js";

const baseline = {
	meta: { version: 1, at: "2026-01-01T00:00:00.000Z", gribbleVersion: "0.0.0", viewports: {} },
	findings: [
		{ fingerprint: "det1", rule: "links/broken", severity: "error", route: "/", firstSeen: { at: "x" } },
		{ fingerprint: "ai1", rule: "review/ux", severity: "warn", route: "/", firstSeen: { at: "x" } },
	],
	metrics: {},
} as unknown as Baseline;

describe("diffAgainstBaseline auditedRules", () => {
	it("only reports fixed for rules that ran", () => {
		const reviewOnly = diffAgainstBaseline([], baseline, {
			auditedRoutes: ["/"],
			auditedRules: (rule) => rule.startsWith("review/"),
		});
		expect(reviewOnly.fixed.map((f) => f.fingerprint)).toEqual(["ai1"]);

		const gateOnly = diffAgainstBaseline([], baseline, {
			auditedRoutes: ["/"],
			auditedRules: (rule) => !rule.startsWith("review/"),
		});
		expect(gateOnly.fixed.map((f) => f.fingerprint)).toEqual(["det1"]);
	});

	it("reports everything fixed when no filter is given", () => {
		expect(diffAgainstBaseline([], baseline, { auditedRoutes: ["/"] }).fixed).toHaveLength(2);
	});
});

describe("writeBaseline screenshots modes", () => {
	it("writes a .gitattributes for Git LFS and records the render platform", async () => {
		const { mkdtemp, readFile, rm } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const { LFS_GITATTRIBUTES, readBaseline, writeBaseline } = await import("../src/baseline/io.js");
		const dir = await mkdtemp(join(tmpdir(), "gribble-lfs-"));
		try {
			const report = {
				version: 1,
				gribbleVersion: "0.0.0",
				generatedAt: "2026-01-01T00:00:00.000Z",
				mode: "gate",
				target: { name: "", url: "http://localhost" },
				budget: { steps: 0, maxSteps: 1, tokens: 0, maxTokens: 1, costUsd: 0 },
				baseline: { present: false, bootstrap: true },
				summary: {
					counts: { critical: 0, error: 0, warn: 0, info: 0 },
					newCount: 0,
					existingCount: 0,
					fixedCount: 0,
					gate: "pass",
					headline: "",
				},
				findings: [],
				routes: [],
				flows: [],
				durationMs: 0,
			} as unknown as import("../src/report/index.js").Report;
			await writeBaseline(dir, {
				report,
				screenshots: { "/@desktop": new Uint8Array([1, 2, 3]) },
				screenshotsMode: "lfs",
				platform: { os: "linux", arch: "x64", browser: "chromium 1.0" },
			});
			expect(await readFile(join(dir, "baseline", ".gitattributes"), "utf8")).toBe(LFS_GITATTRIBUTES);
			expect((await readBaseline(dir))?.meta.platform).toEqual({
				os: "linux",
				arch: "x64",
				browser: "chromium 1.0",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
