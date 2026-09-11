import type { FailOn } from "./inputs.js";
import { type Finding, type FindingSeverity, type Report, SEVERITY_RANK } from "./types.js";

export interface FailDecision {
	fail: boolean;
	/** Human readable explanation, used for the step failure message and the check run title. */
	reason: string;
	/** Number of new findings at or above the threshold. */
	count: number;
}

const FAIL_ON_RANK: Record<Exclude<FailOn, "none">, number> = {
	critical: SEVERITY_RANK.critical,
	error: SEVERITY_RANK.error,
	warn: SEVERITY_RANK.warn,
};

/** New findings whose severity is at or above `failOn`. */
export function findingsAtOrAbove(findings: Finding[], failOn: FailOn): Finding[] {
	if (failOn === "none") return [];
	const threshold = FAIL_ON_RANK[failOn];
	return findings.filter((f) => f.status === "new" && SEVERITY_RANK[f.severity] >= threshold);
}

/**
 * `fail-on` semantics: the step fails when any *new* finding has a severity at
 * or above the threshold. Existing (baseline) findings never fail the step.
 * `none` never fails, even when the report's gate says "fail".
 */
export function decideFailure(reports: Report[], failOn: FailOn): FailDecision {
	if (failOn === "none") {
		return { fail: false, reason: "fail-on is none; the gribbles only report.", count: 0 };
	}
	const offenders = reports.flatMap((r) => findingsAtOrAbove(r.findings, failOn));
	if (offenders.length === 0) {
		return { fail: false, reason: `No new findings at or above ${failOn}.`, count: 0 };
	}
	const counts = countBySeverity(offenders);
	const parts = (Object.keys(counts) as FindingSeverity[])
		.filter((s) => counts[s] > 0)
		.sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a])
		.map((s) => `${counts[s]} ${s}`);
	return {
		fail: true,
		reason: `${offenders.length} new finding${offenders.length === 1 ? "" : "s"} at or above ${failOn} (${parts.join(", ")}).`,
		count: offenders.length,
	};
}

export function countBySeverity(findings: Finding[]): Record<FindingSeverity, number> {
	const counts: Record<FindingSeverity, number> = { critical: 0, error: 0, warn: 0, info: 0 };
	for (const f of findings) counts[f.severity] += 1;
	return counts;
}

export type CheckConclusion = "success" | "failure" | "neutral";

/**
 * Check run conclusion: `failure` when the step fails per `fail-on`,
 * `neutral` when the report gate failed but `fail-on` does not trigger,
 * `success` otherwise.
 */
export function checkConclusion(reports: Report[], decision: FailDecision): CheckConclusion {
	if (decision.fail) return "failure";
	if (reports.some((r) => r.summary.gate === "fail")) return "neutral";
	return "success";
}
