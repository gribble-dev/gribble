/**
 * Execution completeness, kept apart from findings and from the baseline comparison: a run with no
 * new findings is only a clean run when the ground it set out to cover was actually covered.
 */
import type { CoverageRequirements } from "../config/types.js";
import { plural } from "../util/index.js";
import {
	type BaselineStatus,
	type Completeness,
	INTENTIONAL_NOT_RUN_CODES,
	type NotRunCheck,
	type NotRunReasonCode,
	type Report,
} from "./schema.js";
import { isBlocking } from "./summary.js";

/** True for reason codes that mark an expected omission. Unknown or missing codes are unexpected. */
export function isIntentionalNotRun(code: string | undefined): boolean {
	return code !== undefined && (INTENTIONAL_NOT_RUN_CODES as readonly string[]).includes(code);
}

/** A `notRun` entry with its code and, for intentional codes, `intentional: true`. */
export function notRunEntry(
	rule: string,
	code: NotRunReasonCode,
	reason: string,
	route?: string,
): NotRunCheck {
	return {
		rule,
		...(route !== undefined ? { route } : {}),
		reason,
		code,
		...(isIntentionalNotRun(code) ? { intentional: true } : {}),
	};
}

export interface NotExecuted {
	code: NotRunReasonCode;
	reason: string;
}

export interface CompletenessInput {
	routes: { requested: number; notChecked: Array<NotExecuted & { route: string }> };
	flows: { requested: number; ran: number; notRun: Array<NotExecuted & { flow: string }> };
	notRun: NotRunCheck[];
	review: Completeness["review"];
}

/** Assemble the completeness section. `status` ignores intentional omissions. */
export function buildCompleteness(input: CompletenessInput): Completeness {
	const tag = <T extends NotExecuted>(item: T) => ({ ...item, intentional: isIntentionalNotRun(item.code) });
	const notChecked = input.routes.notChecked.map(tag);
	const flowsNotRun = input.flows.notRun.map(tag);
	const unexpectedChecks = input.notRun.filter((entry) => !isIntentionalNotRun(entry.code)).length;
	const incomplete =
		notChecked.some((r) => !r.intentional) ||
		flowsNotRun.some((f) => !f.intentional) ||
		unexpectedChecks > 0 ||
		input.review.status === "incomplete";
	return {
		status: incomplete ? "incomplete" : "complete",
		routes: {
			requested: input.routes.requested,
			checked: input.routes.requested - notChecked.length,
			notChecked,
		},
		flows: { requested: input.flows.requested, ran: input.flows.ran, notRun: flowsNotRun },
		checks: { notRun: input.notRun.length, unexpected: unexpectedChecks },
		review: input.review,
	};
}

/**
 * Evaluate `coverage.required` against a report. Returns undefined when nothing is required, so the
 * report only carries `completeness.required` for projects that opted in.
 */
export function evaluateCoverage(
	report: Pick<Report, "baseline" | "notRun" | "flows"> & { completeness: Completeness },
	required: CoverageRequirements | undefined,
): Completeness["required"] | undefined {
	if (!required) return undefined;
	const { routes, flows, checks, baseline } = required;
	const wantsFlows = flows === true || (Array.isArray(flows) && flows.length > 0);
	if (!routes && !wantsFlows && !checks && !baseline) return undefined;
	const { completeness } = report;
	const missing: NonNullable<Completeness["required"]>["missing"] = [];

	if (routes) {
		for (const r of completeness.routes.notChecked) {
			if (!r.intentional) missing.push({ kind: "route", name: r.route, code: r.code, reason: r.reason });
		}
	}
	if (wantsFlows) {
		const named = Array.isArray(flows) ? new Set(flows) : undefined;
		for (const f of completeness.flows.notRun) {
			if (f.intentional || (named && !named.has(f.flow))) continue;
			missing.push({ kind: "flow", name: f.flow, code: f.code, reason: f.reason });
		}
		if (named) {
			// A required name that matches nothing in scope is a typo or a deleted flow; never a pass.
			const known = new Set([
				...completeness.flows.notRun.map((f) => f.flow),
				...report.flows.map((f) => f.name),
			]);
			for (const name of named) {
				if (!known.has(name))
					missing.push({ kind: "flow", name, reason: "no flow with this name is in scope for this run" });
			}
		}
	}
	if (checks) {
		for (const entry of report.notRun ?? []) {
			if (isIntentionalNotRun(entry.code)) continue;
			missing.push({
				kind: "check",
				name: entry.route ? `${entry.rule} ${entry.route}` : entry.rule,
				...(entry.code ? { code: entry.code } : {}),
				reason: entry.reason,
			});
		}
	}
	if (baseline && report.baseline.status !== "available") {
		missing.push({
			kind: "baseline",
			name: "baseline",
			reason:
				report.baseline.status === "bootstrap"
					? "this run created the baseline; nothing was compared"
					: "no baseline could be compared with this run",
		});
	}
	return { ok: missing.length === 0, missing };
}

/** Baseline status from the run's inputs. */
export function baselineStatusFor(opts: {
	present: boolean;
	bootstrap: boolean;
	compared: number;
	checked: number;
}): BaselineStatus {
	if (opts.bootstrap) return "bootstrap";
	if (!opts.present) return "not-comparable";
	// A baseline with nothing in common with this run (every checked route is new) compares nothing.
	if (opts.checked > 0 && opts.compared === 0) return "not-comparable";
	return "available";
}

const MAX_NAMES = 5;

function nameList(names: string[]): string {
	const shown = names.slice(0, MAX_NAMES).join(", ");
	return names.length > MAX_NAMES ? `${shown} and ${names.length - MAX_NAMES} more` : shown;
}

/**
 * The dry four-part summary shared by the CLI and the PR comment:
 * Execution / Findings / Baseline, then one Unreached line per reason code, then Required.
 */
export function completenessSummary(report: Report): Array<{ label: string; text: string }> {
	const c = report.completeness;
	if (!c) return [];
	const lines: Array<{ label: string; text: string }> = [];

	const parts = [`${c.routes.checked} of ${plural(c.routes.requested, "route")} checked`];
	if (c.flows.requested > 0) parts.push(`${c.flows.ran} of ${plural(c.flows.requested, "flow")} ran`);
	if (c.checks.unexpected > 0) parts.push(`${plural(c.checks.unexpected, "check")} not run`);
	if (c.review.status === "incomplete")
		parts.push(`review incomplete (${c.review.code ?? c.review.reason ?? "unknown"})`);
	else if (c.review.status === "skipped") parts.push(`review skipped (${c.review.code ?? "unknown"})`);
	lines.push({ label: "Execution", text: `${c.status} — ${parts.join(", ")}` });

	const blocking = report.findings.filter(isBlocking).length;
	const scope = c.status === "complete" ? "" : " in completed checks";
	const advisory = report.summary.newCount - blocking;
	let findings: string;
	if (report.baseline.bootstrap) findings = `${plural(report.findings.length, "finding")} recorded as known`;
	else if (blocking === 0)
		findings = `no new blocking findings${scope}${advisory > 0 ? `; ${advisory} new advisory` : ""}`;
	else
		findings = `${plural(blocking, "new blocking finding")}${scope}${advisory > 0 ? `, ${advisory} new advisory` : ""}`;
	lines.push({ label: "Findings", text: findings });

	const b = report.baseline;
	const status = b.status ?? (b.bootstrap ? "bootstrap" : b.present ? "available" : "not-comparable");
	if (status === "bootstrap")
		lines.push({ label: "Baseline", text: "bootstrap — this run records the baseline" });
	else if (status === "not-comparable")
		lines.push({ label: "Baseline", text: "not comparable — no baseline data matches this run" });
	else if (b.routes && b.routes.notComparable.length > 0) {
		const n = b.routes.notComparable.length;
		lines.push({
			label: "Baseline",
			text: `available for ${plural(b.routes.compared, "route")}; ${n} ${n === 1 ? "has" : "have"} no comparable baseline`,
		});
	} else lines.push({ label: "Baseline", text: "available" });

	const byCode = new Map<string, string[]>();
	for (const r of c.routes.notChecked) if (!r.intentional) push(byCode, r.code, r.route);
	for (const f of c.flows.notRun) if (!f.intentional) push(byCode, f.code, `flow ${f.flow}`);
	for (const [code, names] of byCode)
		lines.push({ label: "Unreached", text: `${nameList(names)} — ${code}` });

	const excluded = new Map<string, string[]>();
	for (const r of c.routes.notChecked) if (r.intentional) push(excluded, r.code, r.route);
	for (const f of c.flows.notRun) if (f.intentional) push(excluded, f.code, `flow ${f.flow}`);
	for (const [code, names] of excluded)
		lines.push({ label: "Excluded", text: `${nameList(names)} — ${code}` });

	if (c.required && !c.required.ok) {
		const names = c.required.missing.map((m) => (m.kind === "baseline" ? "baseline" : `${m.kind} ${m.name}`));
		lines.push({ label: "Required", text: `missing — ${nameList(names)}` });
	}
	return lines;
}

function push(map: Map<string, string[]>, key: string, value: string): void {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}
