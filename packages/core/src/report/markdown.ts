import { completenessSummary } from "./completeness.js";
import { sortFindings } from "./findings.js";
import { locationKey } from "./fingerprint.js";
import type { Finding, Report } from "./schema.js";

export const SUMMARY_MARKER = "<!-- gribble:summary -->";
export const FINGERPRINT_MARKER_PREFIX = "<!-- gribble:fp:";

export function fingerprintMarker(fingerprint: string): string {
	return `${FINGERPRINT_MARKER_PREFIX}${fingerprint} -->`;
}

function describeLocation(finding: Finding): string {
	const key = locationKey(finding.location);
	const parts: string[] = [];
	if (key) parts.push(`\`${key}\``);
	if (finding.viewport) parts.push(`viewport ${finding.viewport}`);
	return parts.join(" · ");
}

function renderFinding(finding: Finding): string {
	const head = `- **[${finding.rule}](${finding.docsUrl})** \`${finding.route}\` — ${finding.title}`;
	const location = describeLocation(finding);
	const lines = [head];
	if (location) lines.push(`  ${location}`);
	lines.push(`  ${fingerprintMarker(finding.fingerprint)}`);
	return lines.join("  \n");
}

/**
 * Body of the PR summary comment. The first line is the `<!-- gribble:summary -->` marker so the
 * Action can find and update it in place; each listed finding carries a `<!-- gribble:fp:<hash> -->` marker.
 */
export function toMarkdownSummary(
	report: Report,
	opts: { maxComments?: number; reportUrl?: string } = {},
): string {
	const max = opts.maxComments ?? 5;
	const { summary } = report;
	const out: string[] = [SUMMARY_MARKER, "## 🪱 Gribble", "", `**${summary.headline}**`, ""];

	const meta: string[] = [
		`Gate: ${summary.gate === "pass" ? "✅ pass" : "❌ fail"}`,
		`mode \`${report.mode}\``,
	];
	if (report.target.name) meta.push(`target \`${report.target.name}\``);
	if (report.target.environment) meta.push(`env \`${report.target.environment}\``);
	out.push(meta.join(" · "), "");

	const completeness = completenessSummary(report);
	if (completeness.length > 0) {
		for (const line of completeness) out.push(`- **${line.label}:** ${line.text}`);
		out.push("");
	}

	out.push("| Severity | New |", "| --- | ---: |");
	for (const severity of ["critical", "error", "warn", "info"] as const) {
		out.push(`| ${severity} | ${summary.counts[severity]} |`);
	}
	out.push("");

	const newFindings = sortFindings(report.findings.filter((f) => f.status === "new"));
	if (newFindings.length > 0) {
		const shown = newFindings.slice(0, max);
		out.push("### New holes", "");
		for (const finding of shown) out.push(renderFinding(finding));
		out.push("");
		if (newFindings.length > shown.length) {
			out.push(
				`Showing ${shown.length} of ${newFindings.length} holes. The rest are in the full report.`,
				"",
			);
		}
	}

	const fixed = report.fixed ?? [];
	if (fixed.length > 0) {
		out.push("### Patched ✅", "");
		for (const f of fixed) out.push(`- \`${f.rule}\` \`${f.route}\` ${fingerprintMarker(f.fingerprint)}`);
		out.push("");
	}

	if (summary.existingCount > 0) {
		out.push(
			`_${summary.existingCount} known ${summary.existingCount === 1 ? "hole" : "holes"} from the baseline ${summary.existingCount === 1 ? "is" : "are"} not repeated here._`,
			"",
		);
	}

	const footer: string[] = [];
	if (opts.reportUrl) footer.push(`[Full report](${opts.reportUrl})`);
	footer.push(
		`${report.budget.steps} steps, ${report.budget.tokens} tokens, $${report.budget.costUsd.toFixed(2)}`,
	);
	out.push(footer.join(" · "));
	return `${out.join("\n").trimEnd()}\n`;
}
