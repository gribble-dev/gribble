import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
	baselineStatusFor,
	buildCompleteness,
	type CompletenessInput,
	completenessSummary,
	evaluateCoverage,
	isIntentionalNotRun,
	notRunEntry,
	reportJsonSchema,
	reportSchema,
	toMarkdownSummary,
} from "../src/index.js";
import { finding, report } from "./helpers.js";

const NONE = { routes: false, flows: false, checks: false, baseline: false };

function input(partial: Partial<CompletenessInput> = {}): CompletenessInput {
	return {
		routes: { requested: 3, notChecked: [] },
		flows: { requested: 0, ran: 0, notRun: [] },
		notRun: [],
		review: { status: "not-requested" },
		...partial,
	};
}

describe("notRunEntry", () => {
	it("tags intentional codes and leaves the flag off otherwise", () => {
		expect(notRunEntry("html/*", "unsupported", "not HTML", "/feed.xml")).toEqual({
			rule: "html/*",
			route: "/feed.xml",
			reason: "not HTML",
			code: "unsupported",
			intentional: true,
		});
		expect(notRunEntry("site/*", "error", "boom")).toEqual({ rule: "site/*", reason: "boom", code: "error" });
		expect(isIntentionalNotRun("excluded")).toBe(true);
		expect(isIntentionalNotRun("skipped")).toBe(true);
		expect(isIntentionalNotRun(undefined)).toBe(false);
		expect(isIntentionalNotRun("something-new")).toBe(false);
	});
});

describe("buildCompleteness", () => {
	it("is complete when everything ran", () => {
		const c = buildCompleteness(input());
		expect(c).toEqual({
			status: "complete",
			routes: { requested: 3, checked: 3, notChecked: [] },
			flows: { requested: 0, ran: 0, notRun: [] },
			checks: { notRun: 0, unexpected: 0 },
			review: { status: "not-requested" },
		});
	});

	it("ignores intentional omissions when deciding the status", () => {
		const c = buildCompleteness(
			input({
				flows: { requested: 1, ran: 0, notRun: [{ flow: "prod-only", code: "excluded", reason: "env" }] },
				notRun: [notRunEntry("html/*", "unsupported", "not HTML", "/feed.xml")],
			}),
		);
		expect(c.status).toBe("complete");
		expect(c.flows.notRun[0]?.intentional).toBe(true);
		expect(c.checks).toEqual({ notRun: 1, unexpected: 0 });
	});

	it("is incomplete for an unreachable route, a missing flow, an unexpected check or a partial review", () => {
		const route = buildCompleteness(
			input({
				routes: { requested: 3, notChecked: [{ route: "/a", code: "unreachable", reason: "HTTP 500" }] },
			}),
		);
		expect(route.status).toBe("incomplete");
		expect(route.routes.checked).toBe(2);
		expect(route.routes.notChecked[0]?.intentional).toBe(false);

		const flow = buildCompleteness(
			input({
				flows: { requested: 1, ran: 0, notRun: [{ flow: "login", code: "replay-missing", reason: "x" }] },
			}),
		);
		expect(flow.status).toBe("incomplete");

		// Entries without a code (older producers) count as unexpected.
		const check = buildCompleteness(input({ notRun: [{ rule: "perf/*", reason: "Lighthouse failed" }] }));
		expect(check.status).toBe("incomplete");
		expect(check.checks.unexpected).toBe(1);

		const review = buildCompleteness(
			input({ review: { status: "incomplete", code: "budget-exhausted", reason: "max_steps reached" } }),
		);
		expect(review.status).toBe("incomplete");

		const skipped = buildCompleteness(input({ review: { status: "skipped", code: "no-model" } }));
		expect(skipped.status).toBe("complete");
	});
});

describe("baselineStatusFor", () => {
	it("separates bootstrap, available and not comparable", () => {
		expect(baselineStatusFor({ present: false, bootstrap: true, compared: 0, checked: 3 })).toBe("bootstrap");
		expect(baselineStatusFor({ present: true, bootstrap: true, compared: 3, checked: 3 })).toBe("bootstrap");
		expect(baselineStatusFor({ present: true, bootstrap: false, compared: 2, checked: 3 })).toBe("available");
		expect(baselineStatusFor({ present: true, bootstrap: false, compared: 0, checked: 3 })).toBe(
			"not-comparable",
		);
		expect(baselineStatusFor({ present: false, bootstrap: false, compared: 0, checked: 0 })).toBe(
			"not-comparable",
		);
	});
});

describe("evaluateCoverage", () => {
	const completeness = buildCompleteness(
		input({
			routes: {
				requested: 3,
				notChecked: [{ route: "/account", code: "auth-failed", reason: "login failed" }],
			},
			flows: {
				requested: 3,
				ran: 1,
				notRun: [
					{ flow: "checkout", code: "replay-missing", reason: "no replay" },
					{ flow: "prod-only", code: "excluded", reason: "env" },
				],
			},
			notRun: [
				notRunEntry("perf/*", "error", "Lighthouse failed", "/"),
				notRunEntry("html/*", "unsupported", "not HTML", "/feed.xml"),
			],
			review: { status: "incomplete", code: "budget-exhausted", reason: "max_steps" },
		}),
	);
	const base = report([], {
		completeness,
		notRun: [
			notRunEntry("perf/*", "error", "Lighthouse failed", "/"),
			notRunEntry("html/*", "unsupported", "not HTML", "/feed.xml"),
		],
		flows: [{ name: "login", ok: true, kind: "replay", durationMs: 10 }],
		baseline: { present: false, bootstrap: true, status: "bootstrap" },
	}) as Parameters<typeof evaluateCoverage>[0];

	it("returns nothing when no coverage is required", () => {
		expect(evaluateCoverage(base, undefined)).toBeUndefined();
		expect(evaluateCoverage(base, NONE)).toBeUndefined();
	});

	it("lists required routes, flows, checks and the baseline that are missing", () => {
		const result = evaluateCoverage(base, { routes: true, flows: true, checks: true, baseline: true });
		expect(result?.ok).toBe(false);
		expect(result?.missing).toEqual([
			{ kind: "route", name: "/account", code: "auth-failed", reason: "login failed" },
			{ kind: "flow", name: "checkout", code: "replay-missing", reason: "no replay" },
			{ kind: "check", name: "perf/* /", code: "error", reason: "Lighthouse failed" },
			{ kind: "baseline", name: "baseline", reason: "this run created the baseline; nothing was compared" },
		]);
	});

	it("only checks the named flows and flags names that match nothing", () => {
		expect(evaluateCoverage(base, { ...NONE, flows: ["login"] })).toEqual({ ok: true, missing: [] });
		expect(evaluateCoverage(base, { ...NONE, flows: ["prod-only"] })).toEqual({ ok: true, missing: [] });
		expect(evaluateCoverage(base, { ...NONE, flows: ["checkout", "logn"] })?.missing).toEqual([
			{ kind: "flow", name: "checkout", code: "replay-missing", reason: "no replay" },
			{ kind: "flow", name: "logn", reason: "no flow with this name is in scope for this run" },
		]);
	});

	it("never fails on the advisory review", () => {
		expect(evaluateCoverage(base, { ...NONE, flows: ["login"] })?.ok).toBe(true);
	});

	it("accepts an available baseline", () => {
		const available = {
			...base,
			baseline: { present: true, bootstrap: false, status: "available" as const },
		};
		expect(evaluateCoverage(available, { ...NONE, baseline: true })).toEqual({ ok: true, missing: [] });
	});
});

describe("completenessSummary", () => {
	it("renders the Execution / Findings / Baseline / Unreached block", () => {
		const completeness = buildCompleteness(
			input({
				routes: {
					requested: 10,
					notChecked: [
						{ route: "/account/settings", code: "auth-failed", reason: "login failed" },
						{ route: "/messages", code: "auth-failed", reason: "login failed" },
					],
				},
			}),
		);
		const r = report([finding({ rule: "seo/title", route: "/", title: "Missing title", severity: "warn" })], {
			mode: "gate",
			completeness,
			baseline: {
				present: true,
				bootstrap: false,
				status: "available",
				routes: { compared: 7, notComparable: [{ route: "/new", reason: "not in the baseline yet" }] },
			},
		});
		expect(completenessSummary(r)).toEqual([
			{ label: "Execution", text: "incomplete — 8 of 10 routes checked" },
			{ label: "Findings", text: "no new blocking findings in completed checks; 1 new advisory" },
			{ label: "Baseline", text: "available for 7 routes; 1 has no comparable baseline" },
			{ label: "Unreached", text: "/account/settings, /messages — auth-failed" },
		]);
	});

	it("names blocking findings, bootstrap, exclusions and a failed policy", () => {
		const completeness = buildCompleteness(
			input({
				flows: { requested: 2, ran: 1, notRun: [{ flow: "prod-only", code: "excluded", reason: "env" }] },
				review: { status: "incomplete", code: "budget-exhausted" },
			}),
		);
		completeness.required = {
			ok: false,
			missing: [{ kind: "baseline", name: "baseline", reason: "bootstrap" }],
		};
		const blocking = finding({ rule: "links/broken", route: "/", title: "Broken link", severity: "error" });
		const r = report([blocking], {
			completeness,
			baseline: { present: false, bootstrap: true, status: "bootstrap" },
		});
		expect(completenessSummary(r)).toEqual([
			{
				label: "Execution",
				text: "incomplete — 3 of 3 routes checked, 1 of 2 flows ran, review incomplete (budget-exhausted)",
			},
			{ label: "Findings", text: "1 finding recorded as known" },
			{ label: "Baseline", text: "bootstrap — this run records the baseline" },
			{ label: "Excluded", text: "flow prod-only — excluded" },
			{ label: "Required", text: "missing — baseline" },
		]);
		const comparing = report([blocking], { completeness: buildCompleteness(input()) });
		expect(completenessSummary(comparing)[1]).toEqual({ label: "Findings", text: "1 new blocking finding" });
	});

	it("is empty for reports without a completeness section", () => {
		expect(completenessSummary(report([]))).toEqual([]);
	});
});

describe("report schema", () => {
	it("validates a report carrying completeness and baseline status, and exports them", () => {
		const completeness = buildCompleteness(input());
		completeness.required = { ok: true, missing: [] };
		const r = report([], {
			completeness,
			notRun: [notRunEntry("html/*", "unsupported", "not HTML", "/feed.xml")],
			baseline: {
				present: true,
				bootstrap: false,
				status: "available",
				routes: { compared: 3, notComparable: [] },
			},
		});
		expect(Value.Check(reportSchema, r)).toBe(true);
		const json = JSON.stringify(reportJsonSchema());
		expect(json).toContain('"completeness"');
		expect(json).toContain('"replay-missing"');
	});

	it("lists the completeness block in the PR summary", () => {
		const r = report([], {
			completeness: buildCompleteness(input()),
			baseline: { present: true, bootstrap: false },
		});
		const md = toMarkdownSummary(r);
		expect(md).toContain("- **Execution:** complete — 3 of 3 routes checked");
		expect(md).toContain("- **Baseline:** available");
	});
});
