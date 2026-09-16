import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { baselineUpdateModeFromYaml, isPushToDefaultBranch, shortSha } from "../src/baseline.js";
import {
	findGribbleDirs,
	findLatestRunDir,
	loadLatestReport,
	parseReportJson,
	ReportError,
} from "../src/report.js";
import { buildAuditArgs, extractStdoutJson, resolveGribbleCommand } from "../src/run-audit.js";
import { report } from "./fixtures.js";

describe("buildAuditArgs", () => {
	it("always passes --ci and --mode, adds the optional flags", () => {
		expect(buildAuditArgs({ mode: "all", all: false, updateBaseline: false })).toEqual([
			"audit",
			"--ci",
			"--mode",
			"all",
		]);
		expect(
			buildAuditArgs({
				mode: "gate",
				target: "apps/web",
				all: false,
				environment: "preview",
				updateBaseline: true,
			}),
		).toEqual([
			"audit",
			"--ci",
			"--mode",
			"gate",
			"--target",
			"apps/web",
			"--env",
			"preview",
			"--update-baseline",
		]);
		expect(buildAuditArgs({ mode: "review", all: true, updateBaseline: false })).toEqual([
			"audit",
			"--ci",
			"--mode",
			"review",
			"--all",
		]);
	});
});

describe("resolveGribbleCommand", () => {
	const bin = process.platform === "win32" ? "gribble.cmd" : "gribble";
	it("prefers the working directory, then the repo root, then npx", () => {
		const wd = path.join("/repo", "apps", "web");
		const present = new Set([path.join(wd, "node_modules", ".bin", bin)]);
		expect(
			resolveGribbleCommand({ workingDirectory: wd, repoRoot: "/repo", exists: (p) => present.has(p) }),
		).toMatchObject({
			how: "working-directory",
			prefixArgs: [],
		});
		const rootOnly = new Set([path.join("/repo", "node_modules", ".bin", bin)]);
		expect(
			resolveGribbleCommand({ workingDirectory: wd, repoRoot: "/repo", exists: (p) => rootOnly.has(p) }),
		).toMatchObject({
			how: "repo-root",
		});
		expect(
			resolveGribbleCommand({ workingDirectory: wd, repoRoot: "/repo", exists: () => false }),
		).toMatchObject({
			how: "npx",
			prefixArgs: ["--yes", "-p", "gribble", "gribble"],
		});
	});

	it("adds the optional review runtime to the npx fallback, but not for gate", () => {
		const npx = (mode: "gate" | "review" | "all") =>
			resolveGribbleCommand({
				workingDirectory: "/repo",
				repoRoot: "/repo",
				mode,
				exists: () => false,
			}).prefixArgs;
		expect(npx("gate")).toEqual(["--yes", "-p", "gribble", "gribble"]);
		expect(npx("review")).toEqual([
			"--yes",
			"-p",
			"gribble",
			"-p",
			"@earendil-works/pi-ai",
			"-p",
			"@earendil-works/pi-coding-agent",
			"gribble",
		]);
		expect(npx("all")).toEqual(npx("review"));
	});
});

describe("extractStdoutJson", () => {
	it("parses clean JSON and recovers from leaked progress lines", () => {
		expect(extractStdoutJson('{"version":1}')).toEqual({ version: 1 });
		expect(extractStdoutJson('3 gribbles are nibbling…\n{"a":1}\n')).toEqual({ a: 1 });
		expect(extractStdoutJson("noise\n[1,2]")).toEqual([1, 2]);
		expect(extractStdoutJson("")).toBeUndefined();
		expect(extractStdoutJson("just noise")).toBeUndefined();
	});
});

describe("report loading", () => {
	it("validates the minimal shape", () => {
		expect(() => parseReportJson("{}")).toThrow(ReportError);
		expect(() => parseReportJson('{"version":2}')).toThrow(/version/);
		expect(() => parseReportJson("nope")).toThrow(/invalid JSON/);
		const ok = parseReportJson(JSON.stringify(report({ findings: [] })));
		expect(ok.summary.gate).toBe("pass");
	});

	it("fills defaults for optional fields", () => {
		const minimal = {
			version: 1,
			summary: { gate: "fail" },
			target: { url: "http://x" },
			findings: [{ fingerprint: "f", rule: "r", severity: "error", status: "new", title: "t", route: "/" }],
		};
		const r = parseReportJson(JSON.stringify(minimal));
		expect(r.findings[0]).toMatchObject({
			message: "",
			source: "deterministic",
			docsUrl: "https://gribble.dev/rules/r",
		});
		expect(r.summary.newCount).toBe(1);
		expect(r.summary.counts.error).toBe(0);
		expect(r.baseline).toEqual({ present: false, bootstrap: false });
		expect(r.target.name).toBe("");
	});

	it("reads latest.json, finds the run dir and discovers .gribble dirs", async () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "gribble-action-"));
		const app = path.join(root, "apps", "web");
		const gribbleDir = path.join(app, ".gribble");
		mkdirSync(path.join(gribbleDir, "runs", "2026-01-01T00-00-00"), { recursive: true });
		mkdirSync(path.join(root, "node_modules", "x", ".gribble"), { recursive: true });
		mkdirSync(path.join(root, ".gribble"), { recursive: true });
		writeFileSync(path.join(gribbleDir, "runs", "latest.json"), JSON.stringify(report({ findings: [] })));
		const loaded = await loadLatestReport(gribbleDir);
		expect(loaded.targetDir).toBe(app);
		expect(loaded.report.version).toBe(1);
		expect(await findLatestRunDir(gribbleDir)).toBe(path.join(gribbleDir, "runs", "2026-01-01T00-00-00"));
		expect(await findGribbleDirs(root)).toEqual([path.join(root, ".gribble"), gribbleDir]);
	});
});

describe("baseline helpers", () => {
	it("reads baseline.update with environment overlays", () => {
		expect(baselineUpdateModeFromYaml("target:\n  url: http://x\n")).toBe("commit");
		expect(baselineUpdateModeFromYaml("baseline:\n  update: pr\n")).toBe("pr");
		expect(baselineUpdateModeFromYaml("baseline:\n  update: manual\n")).toBe("manual");
		expect(baselineUpdateModeFromYaml("baseline:\n  update: bogus\n")).toBe("commit");
		expect(
			baselineUpdateModeFromYaml(
				"baseline:\n  update: pr\nenvironments:\n  preview:\n    baseline:\n      update: manual\n",
				"preview",
			),
		).toBe("manual");
		expect(baselineUpdateModeFromYaml(": : not yaml [")).toBe("commit");
	});

	it("detects pushes to the default branch", () => {
		expect(isPushToDefaultBranch({ eventName: "push", ref: "refs/heads/main", defaultBranch: "main" })).toBe(
			true,
		);
		expect(isPushToDefaultBranch({ eventName: "push", ref: "refs/heads/dev", defaultBranch: "main" })).toBe(
			false,
		);
		expect(
			isPushToDefaultBranch({ eventName: "pull_request", ref: "refs/pull/1/merge", defaultBranch: "main" }),
		).toBe(false);
		expect(shortSha("0123456789abcdef")).toBe("0123456");
	});
});
