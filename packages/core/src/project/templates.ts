import { GRIBBLE_CONFIG_SCHEMA_ID, RULES_CONFIG_SCHEMA_ID } from "../config/json-schema.js";

export interface InitTemplateOptions {
	url: string;
	start?: string;
	/** Model in pi syntax, chosen during init. */
	model: string;
	preset?: "recommended";
}

function padComment(line: string, comment: string, column = 36): string {
	return `${line.padEnd(column)}# ${comment}`;
}

function renderGribbleYaml(opts: InitTemplateOptions): string {
	const start = opts.start
		? padComment(`  start: ${opts.start}`, "optional; Gribble waits until url responds")
		: padComment("  # start: pnpm dev", "optional; Gribble waits until url responds");
	return [
		`# yaml-language-server: $schema=${GRIBBLE_CONFIG_SCHEMA_ID}`,
		"target:",
		padComment(`  url: ${opts.url}`, `or \${PREVIEW_URL}`),
		start,
		padComment("  routes: auto", "auto (from framework) | crawl | [list of paths]"),
		padComment(`model: ${opts.model}`, "pi syntax, supports provider/id:thinking; chosen during init"),
		"review:",
		"  max_comments: 5",
		padComment("  min_confidence: 0.7", "AI findings below this are dropped"),
		padComment("  vision: false", "enable the screenshot tool for the model"),
		"budget:",
		"  max_steps: 200",
		"  max_tokens: 2000000",
		'allowed_origins: [localhost, "*.vercel.app"]',
		"# Later, when needed: environments, auth, baseline, viewports, output.",
		"# Reference: https://gribble.dev/docs/configuration/gribble-yaml",
		"",
	].join("\n");
}

function renderRulesYaml(opts: InitTemplateOptions): string {
	const preset = `gribble:${opts.preset ?? "recommended"}`;
	return [
		`# yaml-language-server: $schema=${RULES_CONFIG_SCHEMA_ID}`,
		"extends:",
		`  - ${preset}`,
		"",
		padComment("ignore: []", "finding fingerprints, added via `gribble ignore <fp>`"),
		"",
		"rules:",
		"  # Tighten or relax anything from the preset. Full list: https://gribble.dev/docs/configuration/rules-reference",
		"  # seo/meta-description: error",
		'  # links/broken-external: [warn, { timeout: 5000, ignore: ["linkedin.com"] }]',
		"  # perf/lcp: [error, { maxMs: 3000 }]",
		"  # network/console-warnings: off",
		"",
		"# Per-route overrides:",
		"# overrides:",
		'#   - routes: ["/admin/**"]',
		"#     rules:",
		"#       seo/*: off",
		"",
	].join("\n");
}

const GUIDELINES_MD = `# Guidelines

This file is read by the AI reviewer on every \`gribble audit --mode review\`. Write the things a
careful human reviewer would check but a script cannot: tone, taste, product rules, what "good"
looks like for this site. Plain English, one guideline per bullet, as concrete as you can make it.

What goes where:

- **rules.yaml** — anything a machine can check: broken links, Lighthouse thresholds, axe rules,
  meta tags, placeholder text. Deterministic, can block a merge.
- **gribble.yaml** — how to run the audit: target URL, dev server command, model, budgets.
- **guidelines.md** (this file) — judgement calls. The reviewer reports violations under
  \`review/guidelines\`; they comment on the PR but never block it.

## Examples

- Copy is calm and specific. No exclamation marks in product UI, no "Oops!" in error messages;
  say what went wrong and what to do next.
- Every destructive action (delete, cancel subscription) asks for confirmation and names the thing
  being deleted.
`;

const FLOWS_README_MD = `# Flows

A flow is a user journey written in Markdown. The AI reviewer walks every flow in this directory
during \`gribble audit --mode review\`. Keep them short and concrete: what to click, what to type,
what must be true at the end.

\`\`\`md
---
name: checkout
requires_auth: user          # optional: auth profile from gribble.yaml, or true
env: [preview, staging]      # optional: only run in these environments
tags: [smoke]                # optional
---
Log in as the test user, search for "running shoes", add the first result to the cart,
open the checkout page and confirm the total matches the cart.
\`\`\`

- \`name\` defaults to the file name.
- Steps that a flow depends on (a login, a seeded record) belong in the flow text or in an auth profile.
- When a flow is stable, record it: Gribble writes \`<name>.replay.json\` next to the Markdown file.
  Recorded flows replay in gate mode without a model and fail the gate when a step breaks (\`flows/replay\`).
- Subdirectories are fine (\`flows/auth/login.md\`). This README is ignored.
`;

const SMOKE_MD = `---
name: smoke
tags: [smoke]
---
Open the home page. Follow every link in the primary navigation, one by one, and confirm each
destination renders a page with a heading and a way back to the home page. Report any dead end,
broken navigation item or page that fails to load.
`;

const GITIGNORE = `runs/
sessions/
cache/
`;

/** Files created by `gribble init`, keyed by path relative to `.gribble/`. */
export function renderInitTemplates(opts: InitTemplateOptions): Record<string, string> {
	return {
		"gribble.yaml": renderGribbleYaml(opts),
		"rules.yaml": renderRulesYaml(opts),
		"guidelines.md": GUIDELINES_MD,
		"flows/README.md": FLOWS_README_MD,
		"flows/smoke.md": SMOKE_MD,
		"baseline/.gitkeep": "",
		".gitignore": GITIGNORE,
	};
}
