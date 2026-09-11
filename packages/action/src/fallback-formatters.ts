/**
 * Minimal formatters used when `@gribble/core` does not (yet) export
 * `toMarkdownSummary` / `toSarif` / `toJUnit`. They produce valid output with
 * the same intent; core's versions are preferred whenever available.
 */
import { type Finding, type FindingSeverity, type Report, SEVERITY_RANK, SUMMARY_MARKER } from "./types.js";

export interface MarkdownSummaryOptions {
	maxComments?: number;
	reportUrl?: string;
}

const SEVERITY_LABEL: Record<FindingSeverity, string> = {
	critical: "critical",
	error: "error",
	warn: "warn",
	info: "info",
};

function escapeMarkdownCell(text: string): string {
	return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function locationLabel(f: Finding): string {
	const loc = f.location;
	if (loc?.file) return loc.symbol ? `\`${loc.file}#${loc.symbol}\`` : `\`${loc.file}\``;
	if (loc?.selector) return `\`${loc.selector}\``;
	if (loc?.path) return `\`${loc.path}\``;
	return "";
}

export function sortFindingsForDisplay(findings: Finding[]): Finding[] {
	return [...findings].sort((a, b) => {
		const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
		if (sev !== 0) return sev;
		const conf = (b.confidence ?? 1) - (a.confidence ?? 1);
		if (conf !== 0) return conf;
		if (a.source !== b.source) return a.source === "deterministic" ? -1 : 1;
		return a.fingerprint.localeCompare(b.fingerprint);
	});
}

export function fallbackMarkdownSummary(report: Report, opts: MarkdownSummaryOptions = {}): string {
	const s = report.summary;
	const lines: string[] = [SUMMARY_MARKER];
	const name = report.target.name ? ` (${report.target.name})` : "";
	lines.push(`## 🐛 Gribble${name}: ${s.gate === "pass" ? "gate passed" : "gate failed"}`);
	lines.push("");
	lines.push(s.headline);
	lines.push("");
	lines.push("| new | existing | fixed | critical | error | warn | info |");
	lines.push("| --- | --- | --- | --- | --- | --- | --- |");
	lines.push(
		`| ${s.newCount} | ${s.existingCount} | ${s.fixedCount} | ${s.counts.critical} | ${s.counts.error} | ${s.counts.warn} | ${s.counts.info} |`,
	);
	lines.push("");

	const fresh = sortFindingsForDisplay(report.findings.filter((f) => f.status === "new"));
	if (fresh.length > 0) {
		const max = opts.maxComments ?? fresh.length;
		const shown = fresh.slice(0, Math.max(max, 0));
		lines.push("### New findings");
		lines.push("");
		lines.push("| severity | rule | route | location | title |");
		lines.push("| --- | --- | --- | --- | --- |");
		for (const f of shown) {
			lines.push(
				`| ${SEVERITY_LABEL[f.severity]} | [\`${f.rule}\`](${f.docsUrl}) | \`${f.route}\` | ${escapeMarkdownCell(locationLabel(f))} | ${escapeMarkdownCell(f.title)} |`,
			);
		}
		lines.push("");
		if (shown.length < fresh.length) {
			lines.push(`Showing ${shown.length} of ${fresh.length} holes. The rest are in the full report.`);
			lines.push("");
		}
	}

	const fixed = report.findings.filter((f) => f.status === "fixed");
	if (fixed.length > 0) {
		lines.push("### Patched since baseline");
		lines.push("");
		for (const f of fixed) lines.push(`- \`${f.rule}\` ${escapeMarkdownCell(f.title)} (\`${f.route}\`)`);
		lines.push("");
	}

	const flows = report.flows.filter((f) => !f.ok);
	if (flows.length > 0) {
		lines.push("### Flows that did not complete");
		lines.push("");
		for (const f of flows) lines.push(`- **${f.name}** (${f.kind}): ${f.error ?? "failed"}`);
		lines.push("");
	}

	if (opts.reportUrl) {
		lines.push(`[Full report](${opts.reportUrl})`);
		lines.push("");
	}
	lines.push(
		`<sub>Gribble ${report.gribbleVersion} · mode ${report.mode} · ${report.target.url}${report.baseline.bootstrap ? " · bootstrap run (no baseline yet)" : ""}</sub>`,
	);
	return lines.join("\n");
}

const SARIF_LEVEL: Record<FindingSeverity, "error" | "warning" | "note"> = {
	critical: "error",
	error: "error",
	warn: "warning",
	info: "note",
};

export function fallbackSarif(report: Report): object {
	const ruleIds = [...new Set(report.findings.map((f) => f.rule))].sort();
	const rules = ruleIds.map((id) => {
		const sample = report.findings.find((f) => f.rule === id);
		return {
			id,
			name: id,
			shortDescription: { text: id },
			helpUri: sample?.docsUrl ?? `https://gribble.dev/rules/${id}`,
		};
	});
	const results = report.findings
		.filter((f) => f.status !== "fixed")
		.map((f) => {
			const result: Record<string, unknown> = {
				ruleId: f.rule,
				ruleIndex: ruleIds.indexOf(f.rule),
				level: SARIF_LEVEL[f.severity],
				message: { text: f.message ? `${f.title}\n\n${f.message}` : f.title },
				partialFingerprints: { "gribble/v1": f.fingerprint },
				baselineState: f.status === "existing" ? "unchanged" : "new",
				properties: {
					severity: f.severity,
					source: f.source,
					route: f.route,
					...(f.confidence !== undefined ? { confidence: f.confidence } : {}),
					...(f.viewport ? { viewport: f.viewport } : {}),
					...(f.suggestion ? { suggestion: f.suggestion } : {}),
				},
			};
			const locations: unknown[] = [];
			if (f.location?.file) {
				locations.push({
					physicalLocation: { artifactLocation: { uri: f.location.file, uriBaseId: "%SRCROOT%" } },
					...(f.location.symbol ? { logicalLocations: [{ name: f.location.symbol, kind: "member" }] } : {}),
				});
			}
			locations.push({
				physicalLocation: {
					artifactLocation: { uri: f.route.replace(/^\//, "") || "/", uriBaseId: "TARGET" },
				},
			});
			result.locations = locations;
			return result;
		});
	return {
		$schema: "https://json.schemastore.org/sarif-2.1.0.json",
		version: "2.1.0",
		runs: [
			{
				tool: {
					driver: {
						name: "Gribble",
						informationUri: "https://gribble.dev",
						version: report.gribbleVersion,
						rules,
					},
				},
				originalUriBaseIds: {
					TARGET: { uri: report.target.url.endsWith("/") ? report.target.url : `${report.target.url}/` },
				},
				automationDetails: {
					id: `gribble/${report.mode}${report.target.name ? `/${report.target.name}` : ""}`,
				},
				results,
			},
		],
	};
}

function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

export function fallbackJUnit(report: Report): string {
	const suiteName = `gribble${report.target.name ? `:${report.target.name}` : ""}`;
	const findings = report.findings.filter((f) => f.status !== "fixed");
	const byRule = new Map<string, Finding[]>();
	for (const f of findings) {
		const list = byRule.get(f.rule) ?? [];
		list.push(f);
		byRule.set(f.rule, list);
	}
	const cases: string[] = [];
	let failures = 0;
	let skipped = 0;
	for (const [rule, list] of [...byRule.entries()].sort(([a], [b]) => a.localeCompare(b))) {
		for (const f of list) {
			const name = escapeXml(`${rule} ${f.route}${f.location?.file ? ` ${f.location.file}` : ""}`);
			const blocking = f.status === "new" && SEVERITY_RANK[f.severity] >= SEVERITY_RANK.error;
			if (f.status === "existing") {
				skipped += 1;
				cases.push(
					`    <testcase classname="${escapeXml(suiteName)}" name="${name}"><skipped message="${escapeXml(`existing in baseline: ${f.title}`)}"/></testcase>`,
				);
				continue;
			}
			if (blocking) failures += 1;
			const tag = blocking ? "failure" : "error";
			const body = escapeXml(
				[f.message, f.suggestion ? `Fix: ${f.suggestion}` : "", f.docsUrl].filter(Boolean).join("\n"),
			);
			cases.push(
				`    <testcase classname="${escapeXml(suiteName)}" name="${name}"><${tag} type="${escapeXml(f.severity)}" message="${escapeXml(f.title)}">${body}</${tag}></testcase>`,
			);
		}
	}
	for (const flow of report.flows) {
		const name = escapeXml(`flows/${flow.kind} ${flow.name}`);
		const time = (flow.durationMs / 1000).toFixed(3);
		if (flow.ok) {
			cases.push(`    <testcase classname="${escapeXml(suiteName)}" name="${name}" time="${time}"/>`);
		} else {
			failures += 1;
			cases.push(
				`    <testcase classname="${escapeXml(suiteName)}" name="${name}" time="${time}"><failure message="${escapeXml(flow.error ?? "flow failed")}"/></testcase>`,
			);
		}
	}
	if (cases.length === 0) {
		cases.push(`    <testcase classname="${escapeXml(suiteName)}" name="The gribbles went hungry"/>`);
	}
	const errors = findings.filter((f) => f.status === "new").length - failures;
	const tests = cases.length;
	const time = (report.durationMs / 1000).toFixed(3);
	return [
		`<?xml version="1.0" encoding="UTF-8"?>`,
		`<testsuites name="gribble" tests="${tests}" failures="${failures}" errors="${Math.max(errors, 0)}" skipped="${skipped}" time="${time}">`,
		`  <testsuite name="${escapeXml(suiteName)}" tests="${tests}" failures="${failures}" errors="${Math.max(errors, 0)}" skipped="${skipped}" time="${time}" timestamp="${escapeXml(report.generatedAt)}">`,
		...cases,
		"  </testsuite>",
		"</testsuites>",
		"",
	].join("\n");
}
