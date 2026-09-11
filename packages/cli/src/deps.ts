import type { AuthInteraction } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
	type AuditOptions,
	createModelRuntime,
	detectRootGitignoreConflict,
	explainRule,
	findGribbleDirs,
	getRule,
	gribbleAgentDir,
	loadProject,
	loginProvider,
	type ModelResolution,
	type Report,
	rankModels,
	recommendationFor,
	renderInitTemplates,
	resolveModel,
	runAudit,
} from "@gribble/core";
import { detectAgents, installedSkillVersion, installSkill, skillTargetPath } from "@gribble/skills";
import { createGitApi, type GitApi } from "./git.js";
import { type InstallBrowser, installBrowser } from "./install-browser.js";
import { clackPrompter, type Prompter, plainPrompter } from "./prompts.js";
import { type ListProviders, listProviders, type RuntimeLike } from "./providers.js";
import { type ReadSettingsModel, readSettingsModel } from "./settings.js";
import { defaultRunContext, type RunContext, type Ui } from "./ui.js";
import { CLI_VERSION } from "./version.js";

/**
 * `AuditOptions` plus the model the CLI resolved up front (PHASE2 §C step 5: core-gate adds an
 * optional `model?: ModelResolution` field; until then the extra key is simply ignored).
 */
export type AuditOptionsWithModel = AuditOptions & { model?: ModelResolution };

export type RunAuditFn = (options: AuditOptionsWithModel) => Promise<Report>;

/**
 * Everything the commands touch that has side effects or needs credentials, so tests can run
 * every command with fakes. `run(argv, deps)` merges a partial over {@link defaultDeps}.
 */
export interface CliDeps {
	context: RunContext;
	version: string;
	/** Prompt implementation; defaults to clack in an interactive terminal, plain lines otherwise. */
	prompter: (ui: Ui, refuse: () => Error) => Prompter;

	// core: audit and project
	runAudit: RunAuditFn;
	loadProject: typeof loadProject;
	findGribbleDirs: typeof findGribbleDirs;
	renderInitTemplates: typeof renderInitTemplates;
	detectRootGitignoreConflict: typeof detectRootGitignoreConflict;
	explainRule: typeof explainRule;
	getRule: typeof getRule;
	gribbleAgentDir: typeof gribbleAgentDir;
	rankModels: typeof rankModels;
	recommendationFor: typeof recommendationFor;

	// core: models and auth
	createModelRuntime: (opts: { agentDir: string; env?: NodeJS.ProcessEnv }) => Promise<RuntimeLike>;
	resolveModel: (opts: {
		runtime: RuntimeLike;
		configured?: string;
		settingsModel?: string;
	}) => Promise<ModelResolution>;
	loginProvider: (opts: {
		runtime: RuntimeLike;
		provider: string;
		apiKey?: string;
		interaction: AuthInteraction;
	}) => Promise<void>;
	listProviders: ListProviders;
	readSettingsModel: ReadSettingsModel;

	// skills
	detectAgents: typeof detectAgents;
	installSkill: typeof installSkill;
	installedSkillVersion: typeof installedSkillVersion;
	skillTargetPath: typeof skillTargetPath;

	// process-level helpers
	git: GitApi;
	installBrowser: InstallBrowser;
}

export function defaultDeps(): CliDeps {
	return {
		context: defaultRunContext(),
		version: CLI_VERSION,
		prompter: (ui, refuse) => (ui.interactive ? clackPrompter(ui.out) : plainPrompter(ui.out, refuse)),

		runAudit: (options) => runAudit(options),
		loadProject,
		findGribbleDirs,
		renderInitTemplates,
		detectRootGitignoreConflict,
		explainRule,
		getRule,
		gribbleAgentDir,
		rankModels,
		recommendationFor,

		createModelRuntime: (opts) => createModelRuntime(opts),
		resolveModel: (opts) => resolveModel({ ...opts, runtime: opts.runtime as ModelRuntime }),
		loginProvider: (opts) => loginProvider({ ...opts, runtime: opts.runtime as ModelRuntime }),
		listProviders,
		readSettingsModel,

		detectAgents,
		installSkill,
		installedSkillVersion,
		skillTargetPath,

		git: createGitApi(),
		installBrowser,
	};
}

/** `CliDeps` with every field optional, including the fields of `context`. */
export type DepsOverrides = Partial<Omit<CliDeps, "context">> & { context?: Partial<RunContext> };

export function mergeDeps(overrides: DepsOverrides = {}): CliDeps {
	const base = defaultDeps();
	return { ...base, ...overrides, context: { ...base.context, ...(overrides.context ?? {}) } };
}
