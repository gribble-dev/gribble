import { type Static, type TObject, type TSchema, Type } from "typebox";
import { RULE_WILDCARDS } from "../rules/ids.js";
import { RULES } from "../rules/registry.js";
import type { GribbleConfig, RulesConfig } from "./types.js";

// ------------------------------------------------------------------ rules.yaml

export const SEVERITIES = ["off", "info", "warn", "error", "critical"] as const;

export const severitySchema = Type.Enum(SEVERITIES, {
	description:
		"Rule severity. `off` disables the rule, `info` is report-only, `warn` comments without blocking, `error` and `critical` fail the gate.",
});

const noOptionsSchema = Type.Object(
	{},
	{ additionalProperties: false, description: "This rule takes no options." },
);

/** Every property optional, unknown keys rejected. `Type.Partial` drops the object options, so build it by hand. */
function partialObject(schema: TObject, description: string): TObject {
	const properties: Record<string, TSchema> = {};
	for (const [key, value] of Object.entries(schema.properties as Record<string, TSchema>)) {
		properties[key] = Type.Optional(value);
	}
	return Type.Object(properties, { additionalProperties: false, description });
}

/** `severity | [severity, options]` for one rule, with the rule's own options schema. */
function ruleSettingSchemaFor(summary: string, options?: TObject): TSchema {
	// Options are partial: whatever is omitted is filled from the rule's defaults.
	const partial = options
		? partialObject(options, "Options; omitted keys use the rule defaults.")
		: noOptionsSchema;
	return Type.Union([severitySchema, Type.Tuple([severitySchema, partial])], { description: summary });
}

/** Generic `severity | [severity, options]`, options unchecked. */
export const ruleSettingSchema = Type.Union(
	[severitySchema, Type.Tuple([severitySchema, Type.Record(Type.String(), Type.Unknown())])],
	{ description: "A severity, or `[severity, { options }]`." },
);

function buildRulesMapSchema(): TObject {
	const properties: Record<string, TSchema> = {};
	for (const wildcard of RULE_WILDCARDS) {
		properties[wildcard] = Type.Optional(
			Type.Enum(SEVERITIES, {
				description: `Severity for every \`${wildcard.slice(0, -1)}\` rule. Explicit rule ids in the same block win.`,
			}),
		);
	}
	for (const rule of RULES) {
		properties[rule.id] = Type.Optional(ruleSettingSchemaFor(rule.summary, rule.optionsSchema));
	}
	return Type.Object(properties, {
		additionalProperties: false,
		description: "Rule settings keyed by rule id (`category/name`) or wildcard (`category/*`).",
		default: {},
	});
}

const rulesMapSchema = buildRulesMapSchema();

/** The same map as `rules:` in rules.yaml, applied last when the environment is selected. */
const environmentRulesSchema = Type.Object(rulesMapSchema.properties as Record<string, TSchema>, {
	additionalProperties: false,
	description:
		"Rule settings applied on top of the resolved rules.yaml cascade (presets, rules and per-route overrides) when this environment is selected with `--env`. Same shape as `rules` in rules.yaml.",
});

export const ruleOverrideSchema = Type.Object(
	{
		routes: Type.Array(Type.String(), {
			description: "Route globs this override applies to, e.g. `/admin/**`.",
			minItems: 1,
		}),
		rules: rulesMapSchema,
	},
	{ additionalProperties: false, description: "Rule settings that apply only to matching routes." },
);

export const rulesConfigSchema = Type.Object(
	{
		extends: Type.Optional(
			Type.Array(Type.String(), {
				description:
					"Presets to start from, applied in order: gribble:recommended, gribble:strict, gribble:seo, gribble:a11y.",
				default: [],
			}),
		),
		ignore: Type.Optional(
			Type.Array(Type.String(), {
				description: "Finding fingerprints to suppress. Add them with `gribble ignore <fingerprint>`.",
				default: [],
			}),
		),
		rules: Type.Optional(rulesMapSchema),
		overrides: Type.Optional(
			Type.Array(ruleOverrideSchema, {
				description: "Per-route overrides, applied after `rules`.",
				default: [],
			}),
		),
	},
	{
		additionalProperties: false,
		title: "Gribble rules",
		description:
			"Schema for .gribble/rules.yaml: presets, ignored fingerprints, rule severities and per-route overrides.",
	},
);

// ---------------------------------------------------------------- gribble.yaml

const targetSchema = Type.Object(
	{
		url: Type.String({
			description: `Base URL of the site under audit. \${VAR} placeholders are replaced from the environment.`,
			minLength: 1,
		}),
		start: Type.Optional(
			Type.String({ description: "Command that starts the dev server. Gribble waits until `url` responds." }),
		),
		routes: Type.Optional(
			Type.Union([Type.Literal("auto"), Type.Literal("crawl"), Type.Array(Type.String())], {
				description:
					"`auto` (read the framework's route files), `crawl` (follow internal links) or a list of paths.",
				default: "auto",
			}),
		),
		readyTimeoutMs: Type.Optional(
			Type.Integer({
				description: "How long to wait for `url` after running `start`, in milliseconds.",
				minimum: 0,
				default: 120000,
			}),
		),
		maxConnectionFailures: Type.Optional(
			Type.Integer({
				description:
					"Stop the audit after this many routes in a row fail with a connection error (the server is gone). 0 disables the check.",
				minimum: 0,
				default: 3,
			}),
		),
	},
	{ additionalProperties: false, description: "What to audit and how to reach it." },
);

const reviewSchema = Type.Object(
	{
		max_comments: Type.Optional(
			Type.Integer({
				description: "Maximum number of new findings posted as PR comments. The rest stay in the report.",
				minimum: 0,
				default: 5,
			}),
		),
		min_confidence: Type.Optional(
			Type.Number({
				description: "AI findings with a lower confidence (0-1) are dropped.",
				minimum: 0,
				maximum: 1,
				default: 0.7,
			}),
		),
		vision: Type.Optional(
			Type.Boolean({
				description:
					"Give the model a screenshot tool. Off by default: the model reads page snapshots instead.",
				default: false,
			}),
		),
		explore: Type.Optional(
			Type.Boolean({
				description: "Let the reviewer explore beyond the listed routes and flows.",
				default: true,
			}),
		),
	},
	{ additionalProperties: false, description: "AI review settings.", default: {} },
);

const budgetSchema = Type.Object(
	{
		max_steps: Type.Optional(
			Type.Integer({ description: "Maximum agent steps (tool calls) per audit.", minimum: 1, default: 200 }),
		),
		max_tokens: Type.Optional(
			Type.Integer({
				description: "Maximum tokens (input + output) per audit.",
				minimum: 1,
				default: 2000000,
			}),
		),
		max_cost_usd: Type.Optional(
			Type.Number({
				description: "Stop the review when the estimated cost exceeds this amount.",
				minimum: 0,
			}),
		),
	},
	{ additionalProperties: false, description: "Limits for the AI review.", default: {} },
);

const allowedOriginsSchema = Type.Array(Type.String(), {
	description:
		"Hostnames or globs the agent may navigate to, e.g. `localhost`, `*.vercel.app`. The target host is always allowed.",
	default: [],
});

const envRefSchema = Type.Record(Type.String(), Type.String(), {
	description: "Map of logical names to environment variable names. Only names go in YAML, never values.",
});

const authProfileSchema = Type.Union(
	[
		Type.Object(
			{
				type: Type.Literal("flow", { description: "Log in by walking a flow file." }),
				flow: Type.String({
					description: "Path of the login flow relative to .gribble/, e.g. flows/auth/login.md.",
				}),
				env: Type.Optional(envRefSchema),
			},
			{ additionalProperties: false },
		),
		Type.Object(
			{
				type: Type.Literal("command", {
					description: "Run a command that prints a Playwright storageState JSON.",
				}),
				command: Type.String({ description: "Shell command to run; stdout must be a storageState JSON." }),
			},
			{ additionalProperties: false },
		),
		Type.Object(
			{
				type: Type.Literal("cookie", {
					description: "Inject a session cookie from an environment variable.",
				}),
				env: Type.Object(
					{ value: Type.String({ description: "Environment variable holding the cookie value." }) },
					{ additionalProperties: false, description: "Where the cookie value comes from." },
				),
				name: Type.String({ description: "Cookie name." }),
				domain: Type.Optional(Type.String({ description: "Cookie domain; defaults to the target host." })),
			},
			{ additionalProperties: false },
		),
		Type.Object(
			{
				type: Type.Literal("header", {
					description: "Send a header from an environment variable on every request.",
				}),
				env: Type.Object(
					{ value: Type.String({ description: "Environment variable holding the header value." }) },
					{ additionalProperties: false, description: "Where the header value comes from." },
				),
				name: Type.String({ description: "Header name, e.g. Authorization." }),
			},
			{ additionalProperties: false },
		),
	],
	{ description: "How to obtain a logged-in session. Secrets are referenced by environment variable name." },
);

const authSchema = Type.Object(
	{
		profiles: Type.Record(Type.String(), authProfileSchema, {
			description: "Named auth profiles; flows reference them with `requires_auth: <name>`.",
		}),
	},
	{ additionalProperties: false, description: "Login profiles for the site under audit." },
);

const baselineSchema = Type.Object(
	{
		screenshots: Type.Optional(
			Type.Union([Type.Literal("commit"), Type.Literal("lfs"), Type.Literal("off")], {
				description:
					"Where baseline screenshots live: committed, in Git LFS, or not stored. Off by default; set it when you enable visual/regression.",
				default: "off",
			}),
		),
		update: Type.Optional(
			Type.Union([Type.Literal("commit"), Type.Literal("pr"), Type.Literal("manual")], {
				description: "How the baseline is refreshed after a merge: commit to main, open a PR, or by hand.",
				default: "commit",
			}),
		),
	},
	{ additionalProperties: false, description: "Baseline storage and update policy.", default: {} },
);

const viewportSchema = Type.Object(
	{
		width: Type.Integer({ description: "Viewport width in CSS pixels.", minimum: 1 }),
		height: Type.Integer({ description: "Viewport height in CSS pixels.", minimum: 1 }),
	},
	{ additionalProperties: false },
);

const viewportsSchema = Type.Record(Type.String(), viewportSchema, {
	description: "Named viewports audited for every route.",
	default: { mobile: { width: 390, height: 844 }, desktop: { width: 1366, height: 768 } },
});

const outputSchema = Type.Object(
	{
		dir: Type.Optional(
			Type.String({
				description: "Directory for run reports, relative to the target directory.",
				default: ".gribble/runs",
			}),
		),
		keep: Type.Optional(
			Type.Integer({
				description: "Number of past runs to keep; older ones are deleted.",
				minimum: 1,
				default: 10,
			}),
		),
	},
	{ additionalProperties: false, description: "Where run reports go.", default: {} },
);

const modelSchema = Type.String({
	description: "Model in pi syntax: `provider/id` or `provider/id:thinking`. Chosen during `gribble init`.",
	minLength: 1,
});

const reusePiAuthSchema = Type.Boolean({
	description: "Reuse the credentials in ~/.pi/agent instead of ~/.gribble.",
	default: false,
});

const environmentOverrideSchema = Type.Object(
	{
		target: Type.Optional(partialObject(targetSchema, "Target overrides for this environment.")),
		model: Type.Optional(modelSchema),
		review: Type.Optional(partialObject(reviewSchema, "Review overrides for this environment.")),
		budget: Type.Optional(partialObject(budgetSchema, "Budget overrides for this environment.")),
		allowed_origins: Type.Optional(allowedOriginsSchema),
		auth: Type.Optional(authSchema),
		baseline: Type.Optional(partialObject(baselineSchema, "Baseline overrides for this environment.")),
		viewports: Type.Optional(viewportsSchema),
		output: Type.Optional(partialObject(outputSchema, "Output overrides for this environment.")),
		reusePiAuth: Type.Optional(reusePiAuthSchema),
		rules: Type.Optional(environmentRulesSchema),
	},
	{
		additionalProperties: false,
		description: "Settings deep-merged over the top level when this environment is selected with `--env`.",
	},
);

export const gribbleConfigSchema = Type.Object(
	{
		target: targetSchema,
		model: Type.Optional(modelSchema),
		review: Type.Optional(reviewSchema),
		budget: Type.Optional(budgetSchema),
		allowed_origins: Type.Optional(allowedOriginsSchema),
		environments: Type.Optional(
			Type.Record(Type.String(), environmentOverrideSchema, {
				description:
					"Named environments such as `preview` or `local`, selected with `gribble audit --env <name>`.",
			}),
		),
		auth: Type.Optional(authSchema),
		baseline: Type.Optional(baselineSchema),
		viewports: Type.Optional(viewportsSchema),
		output: Type.Optional(outputSchema),
		reusePiAuth: Type.Optional(reusePiAuthSchema),
	},
	{
		additionalProperties: false,
		title: "Gribble settings",
		description:
			"Schema for .gribble/gribble.yaml: target, model, review and budget settings, environments and auth.",
	},
);

// Compile-time drift checks: the hand-written interfaces must stay assignable to the schema types.
type GribbleConfigFromSchema = Static<typeof gribbleConfigSchema>;
type RulesConfigFromSchema = Static<typeof rulesConfigSchema>;
const _gribbleCheck: GribbleConfigFromSchema = {} as GribbleConfig;
const _rulesCheck: RulesConfigFromSchema = {} as RulesConfig;
void _gribbleCheck;
void _rulesCheck;
