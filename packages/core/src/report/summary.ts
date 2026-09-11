import { plural } from "../util/index.js";
import type { Finding, ReportSummary } from "./schema.js";

/** True when a finding blocks the gate: new, deterministic, error or critical. */
export function isBlocking(finding: Finding): boolean {
	return (
		finding.status === "new" &&
		finding.source === "deterministic" &&
		(finding.severity === "error" || finding.severity === "critical")
	);
}

/** Headline copy. Jokes stop where the numbers begin. */
export function headlineFor(counts: { newCount: number; blocking: number; existingCount: number }): string {
	const { newCount, blocking, existingCount } = counts;
	if (newCount === 0) {
		if (existingCount === 0) return "The gribbles went hungry. Ship it.";
		return `The gribbles found nothing new. ${plural(existingCount, "known hole")} ${existingCount === 1 ? "remains" : "remain"} in the ledger.`;
	}
	if (blocking > 0) {
		return `The gribbles found ${plural(newCount, "hole")} in your hull — ${blocking} ${blocking === 1 ? "needs" : "need"} patching before you sail.`;
	}
	return `The gribbles found ${plural(newCount, "hole")} in your hull. None are below the waterline.`;
}

/**
 * Counts and gate verdict over a finding list. Counts cover status `new` only; existing findings
 * are counted separately and never fail the gate. `fixedCount` can be passed in from the baseline diff.
 */
export function summarizeReport(
	findings: Finding[],
	opts: { ci?: boolean; fixedCount?: number } = {},
): ReportSummary {
	const counts = { critical: 0, error: 0, warn: 0, info: 0 };
	let newCount = 0;
	let existingCount = 0;
	let fixedInList = 0;
	let blocking = 0;
	for (const finding of findings) {
		if (finding.status === "new") {
			newCount++;
			counts[finding.severity]++;
			if (isBlocking(finding)) blocking++;
		} else if (finding.status === "existing") {
			existingCount++;
		} else {
			fixedInList++;
		}
	}
	const fixedCount = opts.fixedCount ?? fixedInList;
	return {
		counts,
		newCount,
		existingCount,
		fixedCount,
		gate: blocking > 0 ? "fail" : "pass",
		headline: headlineFor({ newCount, blocking, existingCount }),
	};
}
