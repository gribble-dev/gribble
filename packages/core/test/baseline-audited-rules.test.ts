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
