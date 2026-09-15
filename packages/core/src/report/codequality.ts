import type { Finding, Report } from "./schema.js";

/** GitLab Code Quality severities, from least to most severe. */
export type CodeQualitySeverity = "info" | "minor" | "major" | "critical" | "blocker";

const CODE_QUALITY_SEVERITY: Record<Finding["severity"], CodeQualitySeverity> = {
	critical: "critical",
	error: "major",
	warn: "minor",
	info: "info",
};

/** One entry of a GitLab Code Quality report (a subset of the Code Climate issue format). */
export interface CodeQualityIssue {
	type: "issue";
	check_name: string;
	description: string;
	content: { body: string };
	categories: string[];
	severity: CodeQualitySeverity;
	fingerprint: string;
	location: { path: string; lines: { begin: number } };
}

/**
 * GitLab Code Quality JSON (`gl-code-quality.json`): one issue per active finding.
 *
 * GitLab diffs the merge request's report against the target branch's by `fingerprint`, so the
 * finding fingerprint is used verbatim. `location.path` is `location.file` when the finding was
 * mapped to source, otherwise the route; Gribble locates by symbol, never by line, so
 * `lines.begin` is always 1. Fixed findings are omitted, as in SARIF and JUnit.
 */
export function toCodeQuality(report: Report): CodeQualityIssue[] {
	return report.findings
		.filter((f) => f.status !== "fixed")
		.map((finding) => {
			const file = finding.location?.file;
			const body = [
				finding.message,
				finding.location?.symbol ? `Symbol: ${finding.location.symbol}` : "",
				finding.location?.selector ? `Selector: ${finding.location.selector}` : "",
				finding.subject ? `Subject: ${finding.subject}` : "",
				finding.suggestion ? `Fix: ${finding.suggestion}` : "",
				finding.docsUrl,
			]
				.filter(Boolean)
				.join("\n\n");
			return {
				type: "issue",
				check_name: finding.rule,
				description: file ? `${finding.title} (${finding.route})` : finding.title,
				content: { body },
				categories: [finding.rule.split("/")[0] ?? finding.rule],
				severity: CODE_QUALITY_SEVERITY[finding.severity],
				fingerprint: finding.fingerprint,
				location: { path: file ?? finding.route, lines: { begin: 1 } },
			};
		});
}
