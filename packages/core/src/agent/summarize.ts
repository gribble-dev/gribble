import { SEVERITY_RANK } from "../report/findings.js";
import type { Finding } from "../report/schema.js";
import { truncate } from "./format.js";

/**
 * Deterministic results rendered as compact markdown for the audit prompt: grouped by rule,
 * highest severity first, one line per finding, capped at `max` lines (default 60).
 */
export function summarizeForPrompt(findings: Finding[], opts: { max?: number } = {}): string {
	const max = opts.max ?? 60;
	const deterministic = findings.filter((f) => f.source === "deterministic" && f.status !== "fixed");
	if (deterministic.length === 0) return "_No deterministic findings._";

	const groups = new Map<string, Finding[]>();
	for (const finding of deterministic) {
		const list = groups.get(finding.rule) ?? [];
		list.push(finding);
		groups.set(finding.rule, list);
	}
	const ordered = [...groups.entries()].sort((a, b) => {
		const sa = Math.max(...a[1].map((f) => SEVERITY_RANK[f.severity]));
		const sb = Math.max(...b[1].map((f) => SEVERITY_RANK[f.severity]));
		return sb - sa || b[1].length - a[1].length || a[0].localeCompare(b[0]);
	});

	const lines: string[] = [];
	let shown = 0;
	let omitted = 0;
	for (const [rule, list] of ordered) {
		const sorted = [...list].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
		lines.push(`- **${rule}** (${list.length})`);
		for (const finding of sorted) {
			if (shown >= max) {
				omitted++;
				continue;
			}
			const where = finding.location?.file
				? `${finding.location.file}${finding.location.symbol ? `#${finding.location.symbol}` : ""}`
				: finding.location?.selector;
			const parts = [`${finding.severity}`, finding.route, truncate(finding.title, 100)];
			if (finding.subject) parts.push(`subject: ${truncate(finding.subject, 80)}`);
			if (where) parts.push(`at ${where}`);
			lines.push(`  - ${parts.join(" · ")}`);
			shown++;
		}
	}
	if (omitted > 0) lines.push(`- _${omitted} more not shown._`);
	return lines.join("\n");
}
