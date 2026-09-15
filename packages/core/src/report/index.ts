export { type CodeQualityIssue, type CodeQualitySeverity, toCodeQuality } from "./codequality.js";
export {
	applyRulePolicy,
	capSeverity,
	dedupeFindings,
	diceCoefficient,
	FUZZY_TITLE_THRESHOLD,
	normalizeTitle,
	SEVERITY_RANK,
	sortFindings,
} from "./findings.js";
export { computeFingerprint, type FingerprintInput, locationKey, normalizeRoute } from "./fingerprint.js";
export { toJUnit } from "./junit.js";
export {
	FINGERPRINT_MARKER_PREFIX,
	fingerprintMarker,
	SUMMARY_MARKER,
	toMarkdownSummary,
} from "./markdown.js";
export { toSarif } from "./sarif.js";
export {
	FINDING_SEVERITIES,
	type Finding,
	type FindingLocation,
	type FindingSeverity,
	type FixedFinding,
	type FlowResult,
	findingLocationSchema,
	findingSchema,
	findingSeveritySchema,
	fixedFindingSchema,
	flowResultSchema,
	type Report,
	type ReportSummary,
	type RouteMetrics,
	type RouteResult,
	reportSchema,
	reportSummarySchema,
	routeMetricsSchema,
	routeResultSchema,
} from "./schema.js";
export { headlineFor, isBlocking, summarizeReport } from "./summary.js";
export {
	LATEST_REPORT_FILE,
	pruneRuns,
	RUN_REPORT_FILE,
	RUNS_DIR,
	runDirName,
	writeRunReport,
} from "./write.js";

import { REPORT_SCHEMA_ID, toJsonSchema } from "../config/json-schema.js";
import { reportSchema } from "./schema.js";

/** JSON Schema (draft 2020-12) for report.json, `$id` https://gribble.dev/schema/report.json. */
export function reportJsonSchema(): Record<string, unknown> {
	return toJsonSchema(reportSchema, REPORT_SCHEMA_ID);
}
