import type { AuditEvent } from "@gribble/core";
import { describe, expect, it } from "vitest";
import { createEventRenderer } from "../src/render/index.js";
import { createUi } from "../src/ui.js";
import { fakeSpinner, finding, report, testIo } from "./helpers.js";

const brokenLink = finding({
	rule: "links/broken",
	route: "/pricing",
	title: "/docs/plans returns 404",
	severity: "error",
	subject: "/docs/plans",
	location: { file: "src/routes/pricing.tsx", symbol: "PlansLink" },
});
const label = finding({
	rule: "a11y/form-labels",
	route: "/signup",
	title: "Input #email has no associated label",
	severity: "error",
	location: { selector: "#email" },
});
const copyFinding = finding({
	rule: "review/copy",
	route: "/pricing",
	title: '"Contact sales" and "Talk to sales" on the same page',
	severity: "warn",
	source: "ai",
	confidence: 0.82,
});
const notStreamed = finding({
	rule: "seo/meta-description",
	route: "/blog/[slug]",
	title: "22 characters, minimum is 50",
});

const stream: AuditEvent[] = [
	{ type: "phase", phase: "prepare", message: "preparing" },
	{ type: "phase", phase: "server", message: "starting pnpm dev" },
	{ type: "log", level: "info", message: "dev server responded after 3.1s" },
	{ type: "phase", phase: "routes", message: "discovering routes" },
	{ type: "log", level: "debug", message: "framework: sveltekit" },
	{ type: "phase", phase: "gate", message: "running deterministic checks" },
	{ type: "route:start", route: "/", viewport: "desktop" },
	{ type: "check:start", rule: "links/broken", route: "/" },
	{ type: "check:end", rule: "links/broken", route: "/", durationMs: 120, findings: 0 },
	{ type: "check:end", rule: "seo/title", route: "/", durationMs: 4 },
	{ type: "route:end", route: "/", viewport: "desktop", durationMs: 800 },
	{ type: "route:start", route: "/pricing", viewport: "desktop" },
	{ type: "check:end", rule: "links/broken", route: "/pricing", durationMs: 200, findings: 1 },
	{ type: "finding", finding: brokenLink },
	{ type: "check:end", rule: "a11y/axe", route: "/pricing", durationMs: 900 },
	{ type: "route:end", route: "/pricing", viewport: "desktop" },
	{ type: "finding", finding: label },
	{ type: "log", level: "warn", message: "lighthouse skipped: could not attach to the CDP endpoint" },
	{ type: "flow:start", flow: "smoke" },
	{ type: "flow:end", flow: "smoke", ok: true, durationMs: 1500 },
	{ type: "flow:start", flow: "checkout" },
	{
		type: "flow:end",
		flow: "checkout",
		ok: false,
		durationMs: 2100,
		error: 'step 3: no element matching "text=Pay"',
	},
	{ type: "phase", phase: "review", message: "reviewing" },
	{ type: "agent", event: { type: "tool_execution_start", toolName: "page_snapshot" } as never },
	{ type: "agent", event: { type: "tool_execution_start", toolName: "add_finding" } as never },
	{ type: "finding", finding: copyFinding },
	{ type: "budget", steps: 40, maxSteps: 200, tokens: 120_000, maxTokens: 2_000_000, costUsd: 0.12 },
	{ type: "phase", phase: "baseline", message: "comparing with the baseline" },
	{ type: "phase", phase: "report", message: "writing the report" },
];

const finalReport = report([brokenLink, label, copyFinding, notStreamed], {
	mode: "all",
	model: { provider: "prov", id: "model-x" },
	summary: {
		counts: { critical: 0, error: 2, warn: 2, info: 0 },
		newCount: 4,
		existingCount: 3,
		fixedCount: 1,
		gate: "fail",
		headline: "The gribbles found 4 holes in your hull — 2 need patching before you sail.",
	},
});

describe("event renderer", () => {
	it("renders a plain (CI) stream to stderr without ANSI", () => {
		const io = testIo({ env: { CI: "true" } });
		const ui = createUi({ context: io.context, machine: true });
		const renderer = createEventRenderer({
			ui,
			mode: "plain",
			url: "http://localhost:3000",
			model: "prov/model-x",
		});
		renderer.start();
		for (const e of stream) renderer.onEvent(e);
		renderer.onEvent({ type: "done", report: finalReport });
		renderer.finish(finalReport, { reportPath: ".gribble/runs/2026-09-12T10-20-30-123Z/report.json" });
		expect(io.stdout.text).toBe("");
		expect(io.stderr.text).not.toMatch(/\[[0-9;]*m/);
		expect(io.stderr.text).toMatchSnapshot();
	});

	it("renders a TTY stream with spinner updates and live findings", () => {
		const io = testIo({ isTTY: true });
		const ui = createUi({ context: io.context });
		const spinnerLog: string[] = [];
		const renderer = createEventRenderer({
			ui,
			mode: "tty",
			spinner: fakeSpinner(spinnerLog),
			url: "http://localhost:3000",
			model: "prov/model-x",
		});
		renderer.start();
		for (const e of stream) renderer.onEvent(e);
		renderer.finish(finalReport, { reportPath: ".gribble/runs/2026-09-12T10-20-30-123Z/report.json" });
		expect(ui.interactive).toBe(true);
		const text = io.stdout.text;
		expect(text).toContain("3 gribbles are nibbling on http://localhost:3000…");
		expect(text).toContain("links/broken");
		expect(text).toContain("src/routes/pricing.tsx#PlansLink");
		expect(text).toContain("seo/meta-description"); // printed at the end because it never streamed
		expect(text).toContain("3 existing · 1 fixed ✅");
		expect(text).toContain("12 steps · 318k tokens · $0.42 · prov/model-x");
		expect(spinnerLog.some((l) => l.includes("nibbling on /pricing"))).toBe(true);
		expect(spinnerLog.some((l) => l.includes("reviewing: page_snapshot"))).toBe(true);
		expect(spinnerLog.filter((l) => l === "[spinner clear]").length).toBeGreaterThan(0);
		expect(spinnerLog.join("\n")).toMatchSnapshot();
	});

	it("celebrates a clean run and a bootstrap run", () => {
		const io = testIo();
		const ui = createUi({ context: io.context });
		const clean = report([]);
		let renderer = createEventRenderer({ ui, mode: "plain", url: "http://localhost:3000" });
		renderer.start();
		renderer.finish(clean);
		expect(io.stdout.text).toContain("The gribbles went hungry. Ship it.");

		const bootstrap = report([brokenLink], { baseline: { present: false, bootstrap: true } });
		renderer = createEventRenderer({
			ui,
			mode: "plain",
			url: "http://localhost:3000",
			targetName: "apps/web",
		});
		renderer.start();
		renderer.finish(bootstrap, { baselineUpdated: true });
		expect(io.stdout.text).toContain("The gribbles board apps/web at http://localhost:3000…");
		expect(io.stdout.text).toContain(
			"No baseline yet — this run is the baseline. 1 finding recorded as known.",
		);
	});
});
