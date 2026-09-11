import type { Finding, Report } from "./schema.js";

function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function isFailure(finding: Finding): boolean {
	return finding.severity === "error" || finding.severity === "critical";
}

/**
 * JUnit XML: one testsuite per rule, one testcase per finding. Findings with severity error or
 * critical are `<failure>`s; warn and info pass and keep their details in `<system-out>`.
 */
export function toJUnit(report: Report): string {
	const active = report.findings.filter((f) => f.status !== "fixed");
	const byRule = new Map<string, Finding[]>();
	for (const finding of active) {
		const list = byRule.get(finding.rule) ?? [];
		list.push(finding);
		byRule.set(finding.rule, list);
	}
	const timestamp = report.generatedAt.replace(/\.\d+Z$/, "");
	const totalFailures = active.filter(isFailure).length;
	const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
	const suiteCount = Math.max(active.length, 1);
	lines.push(
		`<testsuites name="gribble" tests="${suiteCount}" failures="${totalFailures}" errors="0" time="${(report.durationMs / 1000).toFixed(3)}">`,
	);
	if (byRule.size === 0) {
		lines.push(
			`  <testsuite name="gribble" tests="1" failures="0" errors="0" skipped="0" timestamp="${timestamp}">`,
		);
		lines.push('    <testcase name="no holes found" classname="gribble"/>');
		lines.push("  </testsuite>");
	}
	for (const [rule, findings] of [...byRule.entries()].sort(([a], [b]) => a.localeCompare(b))) {
		const failures = findings.filter(isFailure).length;
		lines.push(
			`  <testsuite name="${escapeXml(rule)}" tests="${findings.length}" failures="${failures}" errors="0" skipped="0" timestamp="${timestamp}">`,
		);
		for (const finding of findings) {
			const name = `${finding.route} — ${finding.title}`;
			const details = [
				`severity: ${finding.severity}`,
				`status: ${finding.status}`,
				`fingerprint: ${finding.fingerprint}`,
				finding.location?.file
					? `file: ${finding.location.file}${finding.location.symbol ? `#${finding.location.symbol}` : ""}`
					: "",
				finding.location?.selector ? `selector: ${finding.location.selector}` : "",
				finding.subject ? `subject: ${finding.subject}` : "",
				finding.message,
				finding.suggestion ? `fix: ${finding.suggestion}` : "",
				finding.docsUrl,
			]
				.filter(Boolean)
				.join("\n");
			lines.push(`    <testcase name="${escapeXml(name)}" classname="${escapeXml(rule)}">`);
			if (isFailure(finding)) {
				lines.push(
					`      <failure message="${escapeXml(finding.title)}" type="${escapeXml(finding.severity)}">${escapeXml(details)}</failure>`,
				);
			} else {
				lines.push(`      <system-out>${escapeXml(details)}</system-out>`);
			}
			lines.push("    </testcase>");
		}
		lines.push("  </testsuite>");
	}
	lines.push("</testsuites>");
	return `${lines.join("\n")}\n`;
}
