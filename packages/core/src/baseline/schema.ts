import { type Static, Type } from "typebox";
import { findingLocationSchema, findingSeveritySchema, routeMetricsSchema } from "../report/schema.js";

export const baselineFindingSchema = Type.Object(
	{
		fingerprint: Type.String(),
		rule: Type.String(),
		severity: findingSeveritySchema,
		route: Type.String(),
		location: Type.Optional(findingLocationSchema),
		subject: Type.Optional(Type.String()),
		firstSeen: Type.Object(
			{
				commit: Type.Optional(Type.String()),
				at: Type.String({ description: "ISO 8601 timestamp of the run that first recorded the finding." }),
			},
			{ additionalProperties: false },
		),
	},
	{ additionalProperties: false, description: "A known finding on the default branch." },
);

export const baselineFindingsFileSchema = Type.Object(
	{ version: Type.Literal(1), findings: Type.Array(baselineFindingSchema) },
	{ additionalProperties: false, description: "baseline/findings.json" },
);

export const baselineMetricsFileSchema = Type.Object(
	{ version: Type.Literal(1), routes: Type.Record(Type.String(), routeMetricsSchema) },
	{ additionalProperties: false, description: "baseline/metrics.json" },
);

export const baselineMetaSchema = Type.Object(
	{
		version: Type.Literal(1),
		commit: Type.Optional(Type.String()),
		branch: Type.Optional(Type.String()),
		at: Type.String(),
		gribbleVersion: Type.String(),
		model: Type.Optional(
			Type.Object(
				{ provider: Type.String(), id: Type.String(), thinking: Type.Optional(Type.String()) },
				{ additionalProperties: false },
			),
		),
		viewports: Type.Record(
			Type.String(),
			Type.Object({ width: Type.Integer(), height: Type.Integer() }, { additionalProperties: false }),
		),
	},
	{ additionalProperties: false, description: "baseline/meta.json" },
);

export type BaselineFinding = Static<typeof baselineFindingSchema>;
export type BaselineFindingsFile = Static<typeof baselineFindingsFileSchema>;
export type BaselineMetricsFile = Static<typeof baselineMetricsFileSchema>;
export type BaselineMeta = Static<typeof baselineMetaSchema>;

export interface Baseline {
	meta: BaselineMeta;
	findings: BaselineFinding[];
	/** Route -> metrics. */
	metrics: BaselineMetricsFile["routes"];
}
