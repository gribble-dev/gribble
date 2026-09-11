import { getRule } from "../rules/registry.js";
import type { Finding, Report } from "./schema.js";

const SARIF_LEVEL: Record<Finding["severity"], "error" | "warning" | "note"> = {
	critical: "error",
	error: "error",
	warn: "warning",
	info: "note",
};

/** SARIF 2.1.0 log with one run; rules come from the registry, locations from `finding.location.file`. */
export function toSarif(report: Report): Record<string, unknown> {
	const ruleIds = [...new Set(report.findings.map((f) => f.rule))].sort();
	const ruleIndex = new Map(ruleIds.map((id, i) => [id, i]));
	const rules = ruleIds.map((id) => {
		const meta = getRule(id);
		return {
			id,
			name: id,
			shortDescription: { text: meta?.summary ?? id },
			fullDescription: { text: meta?.description ?? id },
			helpUri: meta?.docsUrl ?? `https://gribble.dev/rules/${id}`,
			help: { text: meta?.fix ?? "" },
			properties: { category: id.split("/")[0], deterministic: meta?.deterministic ?? true },
		};
	});

	const results = report.findings
		.filter((f) => f.status !== "fixed")
		.map((finding) => {
			const locations: unknown[] = [];
			if (finding.location?.file) {
				locations.push({
					physicalLocation: { artifactLocation: { uri: finding.location.file, uriBaseId: "%SRCROOT%" } },
					...(finding.location.symbol
						? { logicalLocations: [{ name: finding.location.symbol, kind: "member" }] }
						: {}),
				});
			}
			locations.push({
				logicalLocations: [{ name: finding.route, kind: "route" }],
				...(finding.location?.selector ? { properties: { selector: finding.location.selector } } : {}),
			});
			return {
				ruleId: finding.rule,
				ruleIndex: ruleIndex.get(finding.rule),
				level: SARIF_LEVEL[finding.severity],
				message: { text: finding.message ? `${finding.title}\n${finding.message}` : finding.title },
				locations,
				partialFingerprints: { "gribble/v1": finding.fingerprint },
				baselineState: finding.status === "existing" ? "unchanged" : "new",
				properties: {
					severity: finding.severity,
					source: finding.source,
					route: finding.route,
					...(finding.confidence !== undefined ? { confidence: finding.confidence } : {}),
					...(finding.subject ? { subject: finding.subject } : {}),
					...(finding.suggestion ? { suggestion: finding.suggestion } : {}),
				},
			};
		});

	return {
		$schema: "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json",
		version: "2.1.0",
		runs: [
			{
				tool: {
					driver: {
						name: "gribble",
						version: report.gribbleVersion,
						informationUri: "https://gribble.dev",
						rules,
					},
				},
				automationDetails: { id: `gribble/${report.target.name || "default"}/${report.mode}` },
				...(report.repo?.commit
					? {
							versionControlProvenance: [
								{ repositoryUri: report.repo.remote ?? "", revisionId: report.repo.commit },
							],
						}
					: {}),
				results,
			},
		],
	};
}
