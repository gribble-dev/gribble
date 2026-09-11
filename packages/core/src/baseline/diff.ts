import { normalizeRoute } from "../report/fingerprint.js";
import type { Finding } from "../report/schema.js";
import type { Baseline, BaselineFinding } from "./schema.js";

export interface BaselineDiff {
	/** Input findings with `status` set to `new` or `existing`. */
	findings: Finding[];
	/** Baseline findings not present any more, limited to audited routes when `auditedRoutes` is given. */
	fixed: BaselineFinding[];
	existingCount: number;
	newCount: number;
}

/**
 * Mark findings as new or existing against the baseline ledger and list what was fixed.
 * Pass `auditedRoutes` for partial (incremental) audits so untouched routes are not reported as fixed.
 */
export function diffAgainstBaseline(
	findings: Finding[],
	baseline: Baseline | undefined,
	opts: { auditedRoutes?: string[] } = {},
): BaselineDiff {
	if (!baseline) {
		const marked = findings.map((f) => ({ ...f, status: "new" as const }));
		return { findings: marked, fixed: [], existingCount: 0, newCount: marked.length };
	}
	const known = new Set(baseline.findings.map((f) => f.fingerprint));
	const current = new Set(findings.map((f) => f.fingerprint));
	const audited = opts.auditedRoutes ? new Set(opts.auditedRoutes.map(normalizeRoute)) : undefined;

	let existingCount = 0;
	let newCount = 0;
	const marked = findings.map((f) => {
		const status = known.has(f.fingerprint) ? ("existing" as const) : ("new" as const);
		if (status === "existing") existingCount++;
		else newCount++;
		return { ...f, status };
	});
	const fixed = baseline.findings.filter(
		(f) => !current.has(f.fingerprint) && (!audited || audited.has(normalizeRoute(f.route))),
	);
	return { findings: marked, fixed, existingCount, newCount };
}
