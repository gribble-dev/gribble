/**
 * Recommended models for Gribble audits.
 *
 * This table is refreshed with every release and is THE ONLY PLACE in the codebase or docs where
 * model identifiers may appear. Entries are provider ids plus a glob over the model id, never a
 * pinned model name: `gribble init` and `gribble models` rank whatever pi's catalog offers against it.
 *
 * Selection criteria: reliable tool calling, long context, no vision required (Gribble reads page
 * snapshots, not screenshots), and a sensible price per audit. Lower `rank` sorts first.
 */
export interface RecommendedModel {
	/** pi provider id, e.g. `anthropic`, `openai`, `google`. */
	provider: string;
	/** Glob matched case-insensitively against the model id within the provider. */
	idPattern: string;
	/** Why it is recommended, shown next to the model in `gribble models`. */
	note: string;
	/** Sort order; lower is better. */
	rank: number;
}

export const RECOMMENDED_MODELS: RecommendedModel[] = [
	{
		provider: "anthropic",
		idPattern: "claude-sonnet-*",
		note: "fast, strong tool calling, no vision needed; the default pick",
		rank: 10,
	},
	{
		provider: "openai",
		idPattern: "gpt-5*",
		note: "strong tool calling and long context; mini variants are cheaper",
		rank: 20,
	},
	{
		provider: "google",
		idPattern: "gemini-*-flash*",
		note: "cheap and fast, good enough for routine reviews",
		rank: 30,
	},
	{
		provider: "google",
		idPattern: "gemini-*-pro*",
		note: "stronger reasoning at a higher price",
		rank: 40,
	},
	{
		provider: "anthropic",
		idPattern: "claude-opus-*",
		note: "most thorough, slow and expensive; use for pre-release full audits",
		rank: 50,
	},
	{
		provider: "anthropic",
		idPattern: "claude-haiku-*",
		note: "cheapest option with adequate tool calling; fine for gate-heavy setups",
		rank: 60,
	},
];
