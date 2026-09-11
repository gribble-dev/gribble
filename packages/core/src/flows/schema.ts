import { type Static, Type } from "typebox";

const selector = (description: string) => Type.String({ description, minLength: 1 });

export const flowStepSchema = Type.Union(
	[
		Type.Object(
			{ action: Type.Literal("navigate"), url: Type.String({ description: "Absolute URL or path." }) },
			{ additionalProperties: false },
		),
		Type.Object(
			{
				action: Type.Literal("click"),
				selector: selector("Playwright selector of the element to click."),
				description: Type.Optional(Type.String({ description: "What the step does, for logs." })),
			},
			{ additionalProperties: false },
		),
		Type.Object(
			{
				action: Type.Literal("fill"),
				selector: selector("Playwright selector of the input."),
				value: Type.String({
					description: `Value to type. Use \${ENV_VAR} for secrets and set secret: true so it is redacted.`,
				}),
				secret: Type.Optional(Type.Boolean({ description: "Redact the value in logs and sessions." })),
			},
			{ additionalProperties: false },
		),
		Type.Object(
			{ action: Type.Literal("press"), key: Type.String({ description: "Key name, e.g. Enter." }) },
			{ additionalProperties: false },
		),
		Type.Object(
			{
				action: Type.Literal("wait_for"),
				selector: Type.Optional(selector("Wait until this selector is visible.")),
				url: Type.Optional(Type.String({ description: "Wait until the URL matches this glob or regex." })),
				text: Type.Optional(Type.String({ description: "Wait until this text is visible." })),
				timeoutMs: Type.Optional(Type.Integer({ description: "Timeout in milliseconds.", minimum: 0 })),
			},
			{ additionalProperties: false },
		),
		Type.Object(
			{
				action: Type.Literal("expect_text"),
				text: Type.String({ description: "Text that must be visible." }),
				selector: Type.Optional(selector("Limit the check to this element.")),
			},
			{ additionalProperties: false },
		),
		Type.Object(
			{
				action: Type.Literal("expect_url"),
				pattern: Type.String({ description: "Glob or regex the URL must match." }),
			},
			{ additionalProperties: false },
		),
		Type.Object(
			{ action: Type.Literal("expect_visible"), selector: selector("Element that must be visible.") },
			{ additionalProperties: false },
		),
	],
	{ description: "One recorded step." },
);

export const flowReplaySchema = Type.Object(
	{
		version: Type.Literal(1),
		name: Type.String({ description: "Flow name; must match the flow's markdown file." }),
		startUrl: Type.String({ description: "URL or path the replay starts at." }),
		steps: Type.Array(flowStepSchema),
	},
	{
		additionalProperties: false,
		title: "Gribble flow replay",
		description:
			"Recorded steps replayed in gate mode; sidecar of flows/<name>.md named flows/<name>.replay.json.",
	},
);

const authRef = Type.Union([Type.String(), Type.Boolean()], {
	description: "Auth profile name from gribble.yaml, or true for the default profile.",
});

export const flowFrontmatterSchema = Type.Object(
	{
		name: Type.Optional(Type.String({ description: "Flow name; defaults to the file name." })),
		requires_auth: Type.Optional(authRef),
		requiresAuth: Type.Optional(authRef),
		env: Type.Optional(Type.Array(Type.String(), { description: "Environments this flow runs in." })),
		tags: Type.Optional(Type.Array(Type.String(), { description: "Free-form tags, e.g. smoke, checkout." })),
	},
	{ description: "Frontmatter of a flows/*.md file." },
);

export type FlowStep = Static<typeof flowStepSchema>;
export type FlowReplay = Static<typeof flowReplaySchema>;
export type FlowFrontmatter = Static<typeof flowFrontmatterSchema>;

export interface Flow {
	name: string;
	/** Absolute path of the markdown file. */
	file: string;
	/** Markdown body: the natural-language description of the journey. */
	description: string;
	requiresAuth?: string | boolean;
	env?: string[];
	tags?: string[];
	replay?: FlowReplay;
}
