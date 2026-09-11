import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { findRepoRoot } from "@gribble/core";
import { AGENT_KINDS, AGENT_LABELS, type AgentKind } from "@gribble/skills";
import { copy } from "../copy.js";
import { EXIT } from "../errors.js";
import type { RuntimeLike } from "../providers.js";
import type { CommandContext } from "./context.js";
import { loginFlow } from "./login.js";

export interface InitOptions {
	yes?: boolean;
	updateSkills?: boolean;
	url?: string;
	start?: string;
	model?: string;
	force?: boolean;
	/** Agent dir override; defaults to `gribbleAgentDir()`. */
	agentDir?: string;
}

const DEFAULT_URL = "http://localhost:3000";

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/** When init could not pick a model, the template's `model:` line becomes a commented hint. */
export function blankModelLine(gribbleYaml: string): string {
	return gribbleYaml.replace(
		/^model: .*$/m,
		"# model: provider/id                # run `gribble login`, then `gribble models` to pick one",
	);
}

async function refreshSkills(ctx: CommandContext, repoRoot: string): Promise<number> {
	const { deps, prompter } = ctx;
	const installed: AgentKind[] = [];
	const seen = new Set<string>();
	for (const kind of AGENT_KINDS) {
		const path = deps.skillTargetPath(repoRoot, kind);
		if (seen.has(path)) continue;
		if ((await deps.installedSkillVersion(path)) !== undefined) {
			installed.push(kind);
			seen.add(path);
		}
	}
	if (installed.length === 0) {
		prompter.warn(copy.init.skillsNoneInstalled);
		return EXIT.ok;
	}
	const results = await deps.installSkill(repoRoot, installed, { force: true });
	for (const r of results) prompter.step(describeSkillResult(r.status, relative(repoRoot, r.path)));
	prompter.success(copy.init.skillsRefreshed(results.length));
	return EXIT.ok;
}

function describeSkillResult(status: "installed" | "updated" | "unchanged", path: string): string {
	if (status === "installed") return copy.init.skillInstalled(path);
	if (status === "updated") return copy.init.skillUpdated(path);
	return copy.init.skillUnchanged(path);
}

/** Pick a model: `--model` wins, then the ranked available list (interactive or first with --yes). */
async function chooseModel(ctx: CommandContext, opts: InitOptions): Promise<string | undefined> {
	const { deps, prompter, ui } = ctx;
	if (opts.model) return opts.model;
	const env = deps.context.env;
	const agentDir = opts.agentDir ?? deps.gribbleAgentDir({ env });

	let runtime: RuntimeLike;
	const spinner = prompter.spinner();
	spinner.start(copy.init.lookingForModels);
	try {
		runtime = await deps.createModelRuntime({ agentDir, env });
	} catch (err) {
		spinner.clear();
		prompter.warn(copy.init.modelRuntimeFailed(err instanceof Error ? err.message : String(err)));
		return undefined;
	}
	let available = deps.rankModels([...(await runtime.getAvailable())]);
	spinner.clear();

	if (available.length === 0) {
		prompter.warn(copy.init.noModels);
		if (opts.yes || !ui.interactive) {
			prompter.info(copy.init.modelSkipped);
			return undefined;
		}
		const login = await prompter.confirm({ message: copy.init.offerLogin, initialValue: true });
		if (!login) {
			prompter.info(copy.init.modelSkipped);
			return undefined;
		}
		await loginFlow(ctx, runtime, {});
		available = deps.rankModels([...(await runtime.getAvailable())]);
		if (available.length === 0) {
			prompter.warn(copy.init.noModels);
			return undefined;
		}
	}

	prompter.info(copy.init.foundModels(available.length));
	const first = available[0];
	if (!first) return undefined;
	if (opts.yes || !ui.interactive) return `${first.provider}/${first.id}`;

	const chosen = await prompter.select<string>({
		message: copy.init.askModel,
		options: available.map((m) => {
			const rec = deps.recommendationFor(m);
			return {
				value: `${m.provider}/${m.id}`,
				label: `${m.provider}/${m.id}`,
				hint: rec ? `${copy.init.recommendedHint}: ${rec.note}` : undefined,
			};
		}),
		initialValue: `${first.provider}/${first.id}`,
	});
	return chosen;
}

async function installSkills(ctx: CommandContext, opts: InitOptions, repoRoot: string): Promise<void> {
	const { deps, prompter, ui } = ctx;
	const detected = await deps.detectAgents(repoRoot);
	let kinds: AgentKind[];
	if (opts.yes || !ui.interactive) {
		kinds = detected.length > 0 ? detected : ["agents"];
	} else {
		prompter.info(
			detected.length > 0 ? copy.init.skillsDetected(detected.length) : copy.init.skillsNoneDetected,
		);
		const teach = await prompter.confirm({ message: copy.init.askSkills, initialValue: true });
		if (!teach) {
			prompter.info(copy.init.skillsSkipped);
			return;
		}
		kinds = await prompter.multiselect<AgentKind>({
			message: copy.init.askSkillTargets,
			options: AGENT_KINDS.map((kind) => ({ value: kind, label: AGENT_LABELS[kind] })),
			initialValues: detected.length > 0 ? detected : ["agents"],
			required: true,
		});
	}
	if (kinds.length === 0) {
		prompter.info(copy.init.skillsSkipped);
		return;
	}
	const results = await deps.installSkill(repoRoot, kinds, { force: opts.force });
	const reported = new Set<string>();
	for (const r of results) {
		if (reported.has(r.path)) continue;
		reported.add(r.path);
		prompter.step(describeSkillResult(r.status, relative(repoRoot, r.path)));
	}
}

/**
 * `gribble init`: the walkthrough. URL, start command, model, templates, root .gitignore check,
 * skills. `--yes` answers every question with its default and never prompts.
 */
export async function runInit(opts: InitOptions, ctx: CommandContext): Promise<number> {
	const { deps, prompter, ui } = ctx;
	const cwd = deps.context.cwd;
	const repoRoot = (await findRepoRoot(cwd)) ?? cwd;

	if (opts.updateSkills) return refreshSkills(ctx, repoRoot);

	prompter.intro(copy.init.intro);
	const interactive = ui.interactive && !opts.yes;

	let url = opts.url;
	if (!url) {
		url = interactive
			? await prompter.text({
					message: copy.init.askUrl,
					placeholder: copy.init.askUrlPlaceholder,
					defaultValue: DEFAULT_URL,
					initialValue: DEFAULT_URL,
				})
			: DEFAULT_URL;
	}
	url = url.trim() || DEFAULT_URL;

	let start = opts.start;
	if (start === undefined && interactive) {
		start = await prompter.text({ message: copy.init.askStart, placeholder: copy.init.askStartPlaceholder });
	}
	start = start?.trim() || undefined;

	const model = await chooseModel(ctx, opts);

	const gribbleDir = join(cwd, ".gribble");
	const files = deps.renderInitTemplates({ url, start, model: model ?? "", preset: "recommended" });
	if (!model && files["gribble.yaml"]) files["gribble.yaml"] = blankModelLine(files["gribble.yaml"]);

	prompter.step(copy.init.writing);
	let written = 0;
	for (const [rel, content] of Object.entries(files)) {
		const path = join(gribbleDir, rel);
		const shown = relative(cwd, path);
		if (!opts.force && (await exists(path))) {
			prompter.info(copy.init.kept(shown));
			continue;
		}
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, content, "utf8");
		prompter.step(copy.init.wrote(shown));
		written++;
	}
	if (written === 0) prompter.info(copy.init.nothingWritten);

	if (await deps.detectRootGitignoreConflict(repoRoot)) prompter.warn(copy.init.gitignoreConflict);

	await installSkills(ctx, opts, repoRoot);

	prompter.note(copy.init.outroNextSteps);
	prompter.outro(copy.init.outro);
	return EXIT.ok;
}
