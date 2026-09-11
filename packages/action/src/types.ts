/**
 * Local copy of the report shape from CONTRACT §4 so the action compiles
 * without depending on `@gribble/core` types at build time.
 */

export type AuditMode = "gate" | "review" | "all";

export type FindingSeverity = "critical" | "error" | "warn" | "info";
export type FindingStatus = "new" | "existing" | "fixed";
export type FindingSource = "deterministic" | "ai";

export interface FindingLocation {
	file?: string;
	symbol?: string;
	selector?: string;
	/** structural fallback */
	path?: string;
}

export interface Finding {
	fingerprint: string;
	/** e.g. "links/broken" */
	rule: string;
	severity: FindingSeverity;
	source: FindingSource;
	/** 0..1, ai only */
	confidence?: number;
	status: FindingStatus;
	title: string;
	message: string;
	/** normalized path, e.g. "/blog/[slug]" */
	route: string;
	viewport?: "mobile" | "desktop" | string;
	location?: FindingLocation;
	subject?: string;
	suggestion?: string;
	evidence?: { screenshot?: string; snippet?: string; url?: string; data?: unknown };
	docsUrl: string;
}

export interface ReportSummary {
	counts: Record<FindingSeverity, number>;
	newCount: number;
	existingCount: number;
	fixedCount: number;
	gate: "pass" | "fail";
	headline: string;
}

export interface RouteMetrics {
	lcpMs?: number;
	cls?: number;
	tbtMs?: number;
	lighthousePerformance?: number;
	pageWeightKb?: number;
	requestCount?: number;
}

export interface RouteResult {
	route: string;
	url: string;
	status?: number;
	metrics?: RouteMetrics;
	snapshot?: string;
	screenshots?: Record<string, string>;
}

export interface FlowResult {
	name: string;
	ok: boolean;
	kind: "replay" | "ai";
	durationMs: number;
	error?: string;
	steps?: number;
}

export interface Report {
	version: 1;
	gribbleVersion: string;
	generatedAt: string;
	mode: AuditMode;
	target: { name: string; url: string; environment?: string };
	repo?: { remote?: string; branch?: string; commit?: string; baseCommit?: string };
	model?: { provider: string; id: string; thinking?: string };
	budget: { steps: number; maxSteps: number; tokens: number; maxTokens: number; costUsd: number };
	baseline: { present: boolean; commit?: string; bootstrap: boolean };
	summary: ReportSummary;
	findings: Finding[];
	routes: RouteResult[];
	flows: FlowResult[];
	durationMs: number;
}

/** A report plus where it was read from. */
export interface LoadedReport {
	report: Report;
	/** Absolute path of the JSON file the report was read from (usually runs/latest.json). */
	path: string;
	/** Absolute path of the `.gribble` directory the report belongs to. */
	gribbleDir: string;
	/** Absolute path of the directory containing `.gribble` (the audited app). */
	targetDir: string;
}

export const SEVERITY_RANK: Record<FindingSeverity, number> = {
	critical: 4,
	error: 3,
	warn: 2,
	info: 1,
};

export const SUMMARY_MARKER = "<!-- gribble:summary -->";
export const FP_MARKER_PREFIX = "<!-- gribble:fp:";
export const FP_MARKER_SUFFIX = " -->";

export function fpMarker(fingerprint: string): string {
	return `${FP_MARKER_PREFIX}${fingerprint}${FP_MARKER_SUFFIX}`;
}
