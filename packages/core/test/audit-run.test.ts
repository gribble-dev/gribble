import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "typebox/value";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEvent, Baseline, Flow } from "../src/index.js";
import { readBaseline, reportSchema, runAudit, viewportsToAudit } from "../src/index.js";
import {
	type FixtureSite,
	hasChromium,
	makeProject,
	SKIP_BROWSER_REASON,
	startFixtureSite,
} from "./browser-helpers.js";

describe("viewportsToAudit", () => {
	it("always includes desktop and adds mobile when a rule asks for it", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gribble-vp-"));
		try {
			const gate = await makeProject({
				url: "http://localhost:3000",
				targetDir: dir,
				rulesYaml: "rules:\n  links/broken: error\n",
			});
			expect(viewportsToAudit(gate)).toEqual(["desktop"]);
			const mobile = await makeProject({
				url: "http://localhost:3000",
				targetDir: dir,
				rulesYaml: "rules:\n  ui/horizontal-overflow: error\n",
			});
			expect(viewportsToAudit(mobile)).toEqual(["desktop", "mobile"]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe.skipIf(!hasChromium())(`runAudit gate mode (${SKIP_BROWSER_REASON})`, () => {
	let site: FixtureSite;
	let dir: string;

	beforeAll(async () => {
		site = await startFixtureSite();
		dir = await mkdtemp(join(tmpdir(), "gribble-audit-"));
	});

	afterAll(async () => {
		await site?.close();
		await rm(dir, { recursive: true, force: true });
	});

	const RULES =
		"extends: [gribble:recommended]\nrules:\n  seo/canonical: off\n  ui/horizontal-overflow: error\n  ui/favicon: off\n";

	it("bootstraps a baseline, writes the run report and emits events", async () => {
		const flows: Flow[] = [
			{
				name: "login",
				file: join(dir, ".gribble/flows/login.md"),
				description: "Sign in.",
				replay: {
					version: 1,
					name: "login",
					startUrl: "/login.html",
					steps: [
						{ action: "fill", selector: "#email", value: "captain@example.com" },
						{ action: "fill", selector: "#password", value: "hunter2" },
						{ action: "click", selector: '[data-testid="submit"]' },
						{ action: "expect_text", text: "Welcome back" },
					],
				},
			},
		];
		const project = await makeProject({
			url: site.url,
			targetDir: dir,
			gribbleYamlExtra: "baseline:\n  screenshots: commit\n",
			rulesYaml: RULES,
			routes: ["/", "/holes.html", "/wide.html"],
			flows,
		});
		const events: AuditEvent[] = [];
		const report = await runAudit({
			project,
			mode: "gate",
			ci: true,
			agentDir: join(dir, "agent"),
			onEvent: (e) => events.push(e),
			git: { commit: "abc123", branch: "main" },
		});

		expect(Value.Check(reportSchema, report)).toBe(true);
		expect(report.mode).toBe("gate");
		expect(report.baseline).toEqual({ present: false, bootstrap: true });
		expect(report.repo).toEqual({ commit: "abc123", branch: "main" });
		expect(report.routes.map((r) => r.route)).toEqual(["/", "/holes.html", "/wide.html"]);
		expect(report.routes[0]?.status).toBe(200);
		expect(report.routes[0]?.snapshot).toBe("snapshots/index.aria.yaml");
		expect(report.routes[0]?.screenshots).toEqual({
			desktop: "screenshots/index@desktop.png",
			mobile: "screenshots/index@mobile.png",
		});
		expect(report.flows).toEqual([
			expect.objectContaining({ name: "login", ok: true, kind: "replay", steps: 4 }),
		]);

		const rules = report.findings.map((f) => f.rule);
		expect(rules).toContain("links/broken");
		expect(rules).toContain("ui/horizontal-overflow");
		expect(rules).toContain("seo/sitemap");
		expect(report.findings.every((f) => f.status === "new")).toBe(true);
		expect(report.summary.gate).toBe("pass"); // bootstrap runs never block
		expect(report.summary.counts.error).toBeGreaterThan(0);
		expect(report.summary.headline).toContain("gribbles");
		expect(report.budget).toEqual({ steps: 0, maxSteps: 200, tokens: 0, maxTokens: 2000000, costUsd: 0 });

		const phases = events.filter((e) => e.type === "phase").map((e) => (e as { phase: string }).phase);
		expect(phases).toEqual(["prepare", "routes", "gate", "baseline", "report"]);
		expect(
			events.some((e) => e.type === "route:start" && e.route === "/holes.html" && e.viewport === "mobile"),
		).toBe(true);
		expect(events.some((e) => e.type === "flow:end" && e.flow === "login" && e.ok)).toBe(true);
		// gribble:recommended switches on three rules that have no checker yet; the audit says so once.
		const warnings = events.flatMap((e) => (e.type === "log" && e.level === "warn" ? [e.message] : []));
		expect(warnings.filter((m) => m.includes("no checker yet"))).toEqual([
			"3 enabled rules have no checker yet and will not run: a11y/focus-visible, a11y/keyboard-reachable, html/deprecated-elements. Planned (accepted in rules.yaml, no checker yet); see gribble explain <rule>.",
		]);
		expect(events.at(-1)?.type).toBe("done");

		const latest = JSON.parse(await readFile(join(dir, ".gribble/runs/latest.json"), "utf8"));
		expect(latest.generatedAt).toBe(report.generatedAt);
		const runs = await readdir(join(dir, ".gribble/runs"));
		expect(runs.filter((r) => r !== "latest.json")).toHaveLength(1);
		const runDir = join(dir, ".gribble/runs", runs.find((r) => r !== "latest.json")!);
		expect((await stat(join(runDir, "screenshots/holes_html@desktop.png"))).size).toBeGreaterThan(0);
		expect(await readFile(join(runDir, "snapshots/index.aria.yaml"), "utf8")).toContain("heading");

		const baseline = (await readBaseline(project.gribbleDir)) as Baseline;
		expect(baseline.findings.length).toBe(report.findings.length);
		expect(baseline.meta.commit).toBe("abc123");
		expect(baseline.metrics["/"]?.requestCount).toBeGreaterThan(0);
		const shots = await readdir(join(project.gribbleDir, "baseline/screenshots"));
		expect(shots).toContain(`index@desktop.chromium-${process.platform}.webp`);
		expect(shots).toContain(`holes_html@mobile.chromium-${process.platform}.webp`);
	}, 180_000);

	it("marks known findings as existing on the next run and reports fixed ones", async () => {
		const project = await makeProject({
			url: site.url,
			targetDir: dir,
			gribbleYamlExtra: "baseline:\n  screenshots: commit\n",
			rulesYaml: RULES,
			routes: ["/", "/holes.html", "/wide.html", "/headings.html"],
		});
		const report = await runAudit({ project, mode: "gate", ci: true, agentDir: join(dir, "agent") });
		expect(Value.Check(reportSchema, report)).toBe(true);
		expect(report.baseline).toEqual({ present: true, commit: "abc123", bootstrap: false });
		const holes = report.findings.filter((f) => f.route === "/holes.html");
		expect(holes.length).toBeGreaterThan(0);
		expect(holes.every((f) => f.status === "existing")).toBe(true);
		const headings = report.findings.filter((f) => f.route === "/headings.html");
		expect(headings.some((f) => f.rule === "seo/single-h1" && f.status === "new")).toBe(true);
		expect(report.summary.existingCount).toBe(
			holes.length +
				report.findings.filter((f) => f.status === "existing" && f.route !== "/holes.html").length,
		);
		expect(report.summary.gate).toBe("fail");
		expect(report.findings.map((f) => f.rule)).not.toContain("visual/regression");
		expect(report.findings.map((f) => f.rule)).not.toContain("structure/regression");
		const latest = JSON.parse(await readFile(join(dir, ".gribble/runs/latest.json"), "utf8"));
		expect(latest.generatedAt).toBe(report.generatedAt);
	}, 180_000);

	it("skips review with a log when no model is available", async () => {
		const project = await makeProject({ url: site.url, targetDir: dir, rulesYaml: RULES, routes: ["/"] });
		const events: AuditEvent[] = [];
		const report = await runAudit({
			project,
			mode: "all",
			ci: true,
			agentDir: join(dir, "agent"),
			onEvent: (e) => events.push(e),
		});
		expect(report.mode).toBe("all");
		expect(
			events.some((e) => e.type === "log" && e.level === "warn" && e.message.includes("Review skipped")),
		).toBe(true);
	}, 120_000);

	it("stops early when the signal aborts", async () => {
		const project = await makeProject({
			url: site.url,
			targetDir: dir,
			rulesYaml: RULES,
			routes: ["/", "/about.html", "/holes.html"],
		});
		const controller = new AbortController();
		const events: AuditEvent[] = [];
		const report = await runAudit({
			project,
			mode: "gate",
			ci: true,
			agentDir: join(dir, "agent"),
			signal: controller.signal,
			onEvent: (e) => {
				events.push(e);
				if (e.type === "route:end") controller.abort();
			},
		});
		expect(events.filter((e) => e.type === "route:end").length).toBeLessThan(6);
		expect(events.some((e) => e.type === "log" && e.message.includes("aborted"))).toBe(true);
		expect(Value.Check(reportSchema, report)).toBe(true);
	}, 120_000);
});
