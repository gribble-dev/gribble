import { describe, expect, it } from "vitest";
import { checkConclusion, decideFailure, findingsAtOrAbove } from "../src/fail.js";
import { finding, report } from "./fixtures.js";

describe("fail-on", () => {
	const findings = [
		finding({ severity: "critical", status: "new" }),
		finding({ severity: "error", status: "new" }),
		finding({ severity: "warn", status: "new", source: "ai", confidence: 0.9 }),
		finding({ severity: "info", status: "new" }),
		finding({ severity: "critical", status: "existing" }),
		finding({ severity: "error", status: "fixed" }),
	];

	it("only counts new findings at or above the threshold", () => {
		expect(findingsAtOrAbove(findings, "critical").map((f) => f.severity)).toEqual(["critical"]);
		expect(findingsAtOrAbove(findings, "error").map((f) => f.severity)).toEqual(["critical", "error"]);
		expect(findingsAtOrAbove(findings, "warn").map((f) => f.severity)).toEqual(["critical", "error", "warn"]);
		expect(findingsAtOrAbove(findings, "none")).toEqual([]);
	});

	it("never fails with none, even when the gate failed", () => {
		const r = report({ findings });
		expect(r.summary.gate).toBe("fail");
		const decision = decideFailure([r], "none");
		expect(decision.fail).toBe(false);
		expect(checkConclusion([r], decision)).toBe("neutral");
	});

	it("fails with a dry, counted reason", () => {
		const decision = decideFailure([report({ findings })], "error");
		expect(decision.fail).toBe(true);
		expect(decision.count).toBe(2);
		expect(decision.reason).toBe("2 new findings at or above error (1 critical, 1 error).");
		expect(checkConclusion([report({ findings })], decision)).toBe("failure");
	});

	it("passes when only existing findings reach the threshold", () => {
		const r = report({ findings: [finding({ severity: "critical", status: "existing" })] });
		const decision = decideFailure([r], "error");
		expect(decision.fail).toBe(false);
		expect(checkConclusion([r], decision)).toBe("success");
	});

	it("aggregates across targets", () => {
		const a = report({ findings: [finding({ severity: "warn" })] });
		const b = report({ findings: [finding({ severity: "error" })] });
		expect(decideFailure([a, b], "error").count).toBe(1);
		expect(decideFailure([a, b], "warn").count).toBe(2);
	});
});
