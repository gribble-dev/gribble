import { type Static, Type } from "typebox";

export const FINDING_SEVERITIES = ["critical", "error", "warn", "info"] as const;

export const findingSeveritySchema = Type.Enum(FINDING_SEVERITIES, {
	description:
		"Severity of a finding. `critical` and `error` fail the gate when the finding is deterministic and new.",
});

export const findingLocationSchema = Type.Object(
	{
		file: Type.Optional(Type.String({ description: "Source file relative to the repository root." })),
		symbol: Type.Optional(
			Type.String({ description: "Component or symbol name inside `file`. Never a line number." }),
		),
		selector: Type.Optional(
			Type.String({ description: "Stable DOM selector (data-testid, id, role+name)." }),
		),
		path: Type.Optional(Type.String({ description: "Structural DOM path; last-resort location." })),
	},
	{ additionalProperties: false, description: "Where the problem is, most stable locator first." },
);

export const findingSchema = Type.Object(
	{
		fingerprint: Type.String({
			description: "First 16 hex characters of sha256(rule, target, route, location, subject).",
		}),
		rule: Type.String({ description: "Rule id, e.g. links/broken." }),
		severity: findingSeveritySchema,
		source: Type.Enum(["deterministic", "ai"], {
			description: "Computed by code, or reported by the reviewer model.",
		}),
		confidence: Type.Optional(Type.Number({ description: "0-1, AI findings only.", minimum: 0, maximum: 1 })),
		status: Type.Enum(["new", "existing", "fixed"], { description: "Relative to the baseline ledger." }),
		title: Type.String({ description: "Short and dry." }),
		message: Type.String({ description: "Details, dry." }),
		route: Type.String({ description: "Normalized route path, e.g. /blog/[slug]." }),
		viewport: Type.Optional(Type.String({ description: "Viewport name the finding was observed in." })),
		location: Type.Optional(findingLocationSchema),
		subject: Type.Optional(Type.String({ description: "Rule-specific key, e.g. the broken link target." })),
		suggestion: Type.Optional(Type.String({ description: "How to fix it." })),
		evidence: Type.Optional(
			Type.Object(
				{
					screenshot: Type.Optional(
						Type.String({ description: "Path to a screenshot in the run directory." }),
					),
					snippet: Type.Optional(Type.String({ description: "Relevant HTML or text excerpt." })),
					url: Type.Optional(Type.String({ description: "URL involved, e.g. a failed request." })),
					data: Type.Optional(Type.Unknown({ description: "Rule-specific structured evidence." })),
				},
				{ additionalProperties: false },
			),
		),
		docsUrl: Type.String({ description: "https://gribble.dev/rules/<rule>" }),
	},
	{ additionalProperties: false, description: "One problem found on one route." },
);

export const routeMetricsSchema = Type.Object(
	{
		lcpMs: Type.Optional(Type.Number({ description: "Largest Contentful Paint in milliseconds." })),
		cls: Type.Optional(Type.Number({ description: "Cumulative Layout Shift." })),
		tbtMs: Type.Optional(Type.Number({ description: "Total Blocking Time in milliseconds." })),
		lighthousePerformance: Type.Optional(
			Type.Number({ description: "Lighthouse performance score, 0-100." }),
		),
		pageWeightKb: Type.Optional(Type.Number({ description: "Total transfer size in kilobytes." })),
		requestCount: Type.Optional(Type.Number({ description: "Number of requests during load." })),
	},
	{ additionalProperties: false, description: "Performance metrics for one route." },
);

export const routeResultSchema = Type.Object(
	{
		route: Type.String({ description: "Normalized route path." }),
		url: Type.String({ description: "URL that was loaded." }),
		status: Type.Optional(Type.Integer({ description: "HTTP status of the document response." })),
		metrics: Type.Optional(routeMetricsSchema),
		snapshot: Type.Optional(
			Type.String({ description: "Path to the aria snapshot YAML in the run directory." }),
		),
		screenshots: Type.Optional(
			Type.Record(Type.String(), Type.String(), {
				description: "Viewport name -> screenshot path in the run directory.",
			}),
		),
	},
	{ additionalProperties: false },
);

export const flowResultSchema = Type.Object(
	{
		name: Type.String({ description: "Flow name from its frontmatter or filename." }),
		ok: Type.Boolean(),
		kind: Type.Enum(["replay", "ai"], {
			description: "Replayed from a recorded script, or walked by the reviewer.",
		}),
		durationMs: Type.Number(),
		error: Type.Optional(Type.String({ description: "Why the flow failed." })),
		steps: Type.Optional(Type.Integer({ description: "Number of steps executed." })),
	},
	{ additionalProperties: false },
);

export const reportSummarySchema = Type.Object(
	{
		counts: Type.Object(
			{
				critical: Type.Integer(),
				error: Type.Integer(),
				warn: Type.Integer(),
				info: Type.Integer(),
			},
			{ additionalProperties: false, description: "New findings per severity." },
		),
		newCount: Type.Integer(),
		existingCount: Type.Integer(),
		fixedCount: Type.Integer(),
		gate: Type.Enum(["pass", "fail"], {
			description: "fail when any new deterministic finding has severity error or critical.",
		}),
		headline: Type.String({ description: "One-line human summary." }),
	},
	{ additionalProperties: false },
);

export const fixedFindingSchema = Type.Object(
	{
		fingerprint: Type.String(),
		rule: Type.String(),
		severity: findingSeveritySchema,
		route: Type.String(),
	},
	{ additionalProperties: false, description: "A baseline finding that is no longer present." },
);

export const reportSchema = Type.Object(
	{
		version: Type.Literal(1),
		gribbleVersion: Type.String(),
		generatedAt: Type.String({ description: "ISO 8601 timestamp." }),
		mode: Type.Enum(["gate", "review", "all"]),
		target: Type.Object(
			{
				name: Type.String({
					description: "Empty for a single-app repo, else the app path such as apps/web.",
				}),
				url: Type.String(),
				environment: Type.Optional(Type.String()),
			},
			{ additionalProperties: false },
		),
		repo: Type.Optional(
			Type.Object(
				{
					remote: Type.Optional(Type.String()),
					branch: Type.Optional(Type.String()),
					commit: Type.Optional(Type.String()),
					baseCommit: Type.Optional(Type.String()),
				},
				{ additionalProperties: false },
			),
		),
		model: Type.Optional(
			Type.Object(
				{
					provider: Type.String(),
					id: Type.String(),
					thinking: Type.Optional(Type.String()),
				},
				{ additionalProperties: false },
			),
		),
		budget: Type.Object(
			{
				steps: Type.Integer(),
				maxSteps: Type.Integer(),
				tokens: Type.Integer(),
				maxTokens: Type.Integer(),
				costUsd: Type.Number(),
			},
			{ additionalProperties: false },
		),
		baseline: Type.Object(
			{
				present: Type.Boolean(),
				commit: Type.Optional(Type.String()),
				bootstrap: Type.Boolean({
					description: "True when this run created the baseline instead of comparing.",
				}),
			},
			{ additionalProperties: false },
		),
		summary: reportSummarySchema,
		findings: Type.Array(findingSchema, { description: "All findings, deduplicated and sorted." }),
		routes: Type.Array(routeResultSchema),
		flows: Type.Array(flowResultSchema),
		fixed: Type.Optional(
			Type.Array(fixedFindingSchema, { description: "Baseline findings that disappeared." }),
		),
		durationMs: Type.Number(),
	},
	{ additionalProperties: false, title: "Gribble report", description: "Output of one `gribble audit` run." },
);

export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];
export type FindingLocation = Static<typeof findingLocationSchema>;
export type Finding = Static<typeof findingSchema>;
export type RouteMetrics = Static<typeof routeMetricsSchema>;
export type RouteResult = Static<typeof routeResultSchema>;
export type FlowResult = Static<typeof flowResultSchema>;
export type ReportSummary = Static<typeof reportSummarySchema>;
export type FixedFinding = Static<typeof fixedFindingSchema>;
export type Report = Static<typeof reportSchema>;
