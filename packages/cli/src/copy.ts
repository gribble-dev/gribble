/**
 * Every user-facing string of the CLI. Progress, empty states and init are allowed to be cute
 * (nautical, tiny bugs). Findings and error messages stay dry: the jokes stop where the bug begins.
 */

export const WORM = "🪱";
export const BUG = "🐛";

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : pluralForm}`;
}

export const copy = {
	program: {
		description: "Tiny bugs that find your bugs before you ship.",
		verbose: "Print debug logs and full stack traces.",
	},

	init: {
		description: "Create .gribble/, choose a model, install agent skills.",
		intro: "Let's put some gribbles in your repo.",
		askUrl: "Where does your site live?",
		askUrlPlaceholder: `http://localhost:3000 or \${PREVIEW_URL}`,
		askStart: "How does it start? (leave blank if it is already running)",
		askStartPlaceholder: "pnpm dev",
		askModel: "Which model should do the reviewing?",
		recommendedHint: "recommended",
		lookingForModels: "Asking your model runtime which models it can reach…",
		foundModels: (n: number) => `${plural(n, "model")} within reach.`,
		noModels: "No model credentials found. The gribbles cannot review without one.",
		offerLogin: "Log in to a model provider now?",
		modelSkipped:
			"Skipped model selection. Run `gribble login` and `gribble models`, then set `model` in .gribble/gribble.yaml.",
		modelRuntimeFailed: (message: string) =>
			`Could not reach the model runtime (${message}). Set \`model\` in .gribble/gribble.yaml later.`,
		writing: "Nesting gribbles in .gribble/…",
		wrote: (file: string) => `created ${file}`,
		kept: (file: string) => `kept ${file} (already exists; pass --force to overwrite)`,
		nothingWritten: "Every file already existed. Nothing overwritten.",
		gitignoreConflict: [
			"Your root .gitignore ignores .gribble/ entirely.",
			"That also ignores rules.yaml, flows/ and baseline/, which should be committed.",
		].join("\n"),
		askSkills: "Teach your coding agent to feed the gribbles?",
		askSkillTargets: "Which agents should learn the Gribble skill?",
		skillsDetected: (n: number) => `Found ${plural(n, "coding agent")} in this repository.`,
		skillsNoneDetected: "No coding agent detected; the skill can still go into .agents/skills.",
		skillInstalled: (path: string) => `skill installed at ${path}`,
		skillUpdated: (path: string) => `skill updated at ${path}`,
		skillUnchanged: (path: string) => `skill already current at ${path}`,
		skillsRefreshed: (n: number) => `${plural(n, "skill file")} refreshed.`,
		skillsNoneInstalled: "No Gribble skill installed yet. Run `gribble init` to add one.",
		skillsSkipped: "The gribbles will feed themselves. Run `gribble init --update-skills` any time.",
		outro: "The gribbles are aboard. Run `gribble audit` when your ship is ready to sail.",
		outroNextSteps: [
			"Next: `gribble install` fetches the browser, `gribble audit` runs the first audit.",
			"Commit .gribble/ (except runs/, sessions/ and cache/; the generated .gitignore handles that).",
		].join("\n"),
		cancelled: "No gribbles were harmed. Run `gribble init` again whenever you are ready.",
	},

	audit: {
		description: "Run an audit against the target in .gribble/gribble.yaml.",
		modeOption: "Which half to run: gate (deterministic, no model), review (AI), or all.",
		ciOption: "Machine-readable: report JSON on stdout, plain progress on stderr, no prompts.",
		targetOption: "Audit one app in a monorepo, e.g. apps/web.",
		allOption: "Audit every .gribble/ in the repository.",
		envOption: "Apply an environments.<name> block from gribble.yaml.",
		updateBaselineOption: "Write .gribble/baseline/ from this run. Does not commit.",
		jsonOption: "Print the report JSON to stdout; progress goes to stderr.",
		routesOption: "Comma-separated routes to audit. Overrides target.routes.",
		changedOption: "Audit only routes affected by the git diff against the base branch.",
		nibbling: (count: number, url: string) => `${WORM} ${count} gribbles are nibbling on ${url}…`,
		nibblingTarget: (target: string, url: string) => `${WORM} The gribbles board ${target} at ${url}…`,
		resolvingModel: "Waking the reviewer…",
		modelReady: (spec: string) => `reviewer: ${spec}`,
		gateOnly: "gate mode: no model needed, no tokens spent.",
		noTargets: (root: string) =>
			`No .gribble/ with a target found under ${root}. Run \`gribble init\` first.`,
		targetsFound: (n: number) => `${plural(n, "target")} to audit.`,
		changedNoGit: "Not a git repository, or no base branch to diff against; auditing everything.",
		changedNone: "No files changed against the base branch; auditing everything.",
		changedFiles: (n: number, base: string) => `${plural(n, "changed file")} against ${base}.`,
		bootstrap: (n: number) =>
			[
				`No baseline yet — this run is the baseline. ${plural(n, "finding")} recorded as known.`,
				"Commit .gribble/baseline/ so future runs have something to diff against.",
			].join("\n"),
		baselineUpdated: "Baseline written to .gribble/baseline/. Stage and commit it when you agree with it.",
		ledger: (existing: number, fixed: number) => {
			const parts: string[] = [];
			if (existing > 0) parts.push(`${existing} existing`);
			if (fixed > 0) parts.push(`${fixed} fixed ✅`);
			return parts.join(" · ");
		},
		reportPath: (path: string) => `Report: ${path}`,
		notRun: (rules: string[], routes: string[], reason: string) => {
			const where =
				routes.length === 1
					? ` on ${routes[0]}`
					: routes.length > 1
						? ` on ${plural(routes.length, "route")}`
						: "";
			return `Not run: ${rules.join(", ")}${where} (${reason})`;
		},
		notRunOn: (count: number) => `not run on ${plural(count, "route")}`,
		usage: (steps: number, tokens: string, cost: string) => `${steps} steps · ${tokens} tokens · ${cost}`,
		gateFailed: "The gate is closed. Patch the holes above before you sail.",
		interrupted: "Interrupted. The gribbles are swimming back to port…",
		interruptedAgain: "Abandoning ship.",
	},

	login: {
		description: "Authenticate with a model provider.",
		apiKeyOption: "Store an API key instead of running an interactive login.",
		pickProvider: "Which provider?",
		configuredHint: (source: string) => `configured via ${source}`,
		notConfiguredHint: "not configured",
		pickMethod: (provider: string) => `How do you want to log in to ${provider}?`,
		methodOAuth: "Sign in with a subscription (OAuth)",
		methodApiKey: "Paste an API key",
		askApiKey: (provider: string) => `API key for ${provider}`,
		unknownProvider: (provider: string, known: string[]) =>
			`Unknown provider "${provider}". Known providers: ${known.join(", ")}.`,
		noProviders: "The model runtime reports no providers. Check your models.json.",
		working: (provider: string) => `Logging in to ${provider}…`,
		done: (provider: string) => `Logged in to ${provider}. The gribbles have a brain now.`,
		apiKeyInHistory:
			'A key passed on the command line lands in your shell history. Prefer --api-key "$MY_KEY".',
		ciNoPrompt:
			"gribble login needs a terminal. In CI, set the provider's API key environment variable instead.",
		cancelled: "Login cancelled.",
		openUrl: "Open this URL in your browser to continue:",
		openingBrowser: "Opening your browser to continue. If nothing opens, use this URL:",
		deviceCode: (uri: string, code: string) => `Visit ${uri} and enter the code ${code}`,
	},

	logout: {
		description: "Remove stored credentials for one provider, or for all of them.",
		nothingStored: "No stored credentials. Environment variables are untouched either way.",
		removed: (provider: string) => `Removed credentials for ${provider}.`,
		removedAll: (n: number) => `Removed credentials for ${plural(n, "provider")}.`,
		notStored: (provider: string) => `No stored credentials for ${provider}.`,
	},

	models: {
		description: "List the models your credentials can reach, recommended first.",
		none: "No models within reach. Run `gribble login` or set a provider API key environment variable.",
		header: (n: number) => `${plural(n, "model")} within reach, recommended first:`,
		recommendedMark: "★",
		hint: "Copy an id into `model` in .gribble/gribble.yaml (pi syntax: provider/id[:thinking]).",
	},

	install: {
		description: "Download the Playwright Chromium build Gribble drives.",
		withDepsOption: "Also install system dependencies (Linux; passes --with-deps to Playwright).",
		starting: "Fetching a browser for the gribbles to crawl in…",
		done: "Browser installed. The gribbles have somewhere to crawl.",
		failed: (code: number) => `Playwright exited with code ${code}.`,
		notFound: "Could not find Playwright's CLI. Is `playwright` installed next to gribble?",
	},

	ignore: {
		description: "Append a finding fingerprint to `ignore` in rules.yaml.",
		targetOption: "Monorepo app directory whose rules.yaml to edit.",
		invalidFingerprint: (value: string) =>
			`"${value}" is not a fingerprint. Expected 16 hex characters, as printed in the report.`,
		noRulesFile: (path: string) => `No rules.yaml at ${path}. Run \`gribble init\` first.`,
		already: (fp: string) => `${fp} is already ignored.`,
		added: (fp: string, path: string) => `Added ${fp} to ignore in ${path}.`,
		reminder: "Add a comment on that line saying why, before you commit it.",
	},

	explain: {
		description: "Describe a rule: what it checks, options, presets, fix hint.",
	},

	baseline: {
		description: "Baseline commands.",
		updateDescription: "Run an audit and write .gribble/baseline/ from it. Does not commit.",
	},

	version: {
		description: "Print the Gribble version.",
	},

	errors: {
		config: "Configuration problem.",
		configHint: "Check .gribble/gribble.yaml and .gribble/rules.yaml, or run `gribble init`.",
		auth: "Model authentication problem.",
		authHint: "Run `gribble login <provider>` or set the provider's API key environment variable.",
		noModelHint: "Run `gribble login`, then `gribble models` to pick one for gribble.yaml.",
		reviewRuntimeHint:
			"The AI review runtime ships as optional peer dependencies, so `--mode gate` installs none of it. No package manager adds them on its own.",
		unexpected: "Unexpected error.",
		unexpectedHint:
			"Re-run with --verbose for a stack trace, and report it at https://github.com/gribble-dev/gribble/issues.",
		devServerHint:
			"Check `target.start` and `target.url` in .gribble/gribble.yaml: the command must serve that URL (build first if it is a preview server). Raise `target.readyTimeoutMs` for slow starts.",
		promptInCi: "This command needs an interactive terminal.",
		cancelled: "Cancelled.",
	},
} as const;

export { plural };
