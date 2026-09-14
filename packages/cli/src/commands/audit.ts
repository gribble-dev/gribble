import { access, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
	type AuditMode,
	formatModelSpec,
	type ModelResolution,
	type ProjectContext,
	type Report,
	runDirName,
	toJUnit,
	toSarif,
} from "@gribble/core";
import { copy } from "../copy.js";
import type { AuditOptionsWithModel } from "../deps.js";
import { CliError, EXIT } from "../errors.js";
import type { GitInfo } from "../git.js";
import { displayPath } from "../paths.js";
import type { RuntimeLike } from "../providers.js";
import { createEventRenderer } from "../render/index.js";
import type { CommandContext } from "./context.js";

export interface AuditCommandOptions {
	mode: AuditMode;
	ci?: boolean;
	json?: boolean;
	target?: string;
	all?: boolean;
	env?: string;
	updateBaseline?: boolean;
	routes?: string[];
	changed?: boolean;
}

export function parseRoutes(value: string | undefined): string[] | undefined {
	if (!value) return undefined;
	const routes = value
		.split(",")
		.map((r) => r.trim())
		.filter(Boolean);
	return routes.length > 0 ? routes : undefined;
}

/** Relative to cwd when inside it, else absolute; no `../../..` chains in output. */
function shortPath(cwd: string, path: string): string {
	const rel = displayPath(cwd, path);
	return rel !== "." && !rel.startsWith("..") ? rel : path;
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/** Directory of this run's report: `<output.dir>/<timestamp>` or `<gribbleDir>/runs/<timestamp>`. */
async function locateRunDir(project: ProjectContext, report: Report): Promise<string | undefined> {
	const name = runDirName(report.generatedAt);
	const candidates = [
		resolve(project.targetDir, project.config.output.dir, name),
		join(project.gribbleDir, "runs", name),
	];
	for (const dir of candidates) if (await exists(dir)) return dir;
	return undefined;
}

async function listTargets(ctx: CommandContext, opts: AuditCommandOptions): Promise<string[]> {
	const { cwd } = ctx.deps.context;
	if (!opts.all) return [opts.target ?? "."];
	const dirs = await ctx.deps.findGribbleDirs(cwd);
	const targets = dirs.map((dir) => displayPath(cwd, dirname(dir)));
	if (targets.length === 0) {
		throw new CliError(copy.audit.noTargets(cwd), { exitCode: EXIT.config });
	}
	return targets;
}

/**
 * The main command. Loads each target, resolves the model up front unless `--mode gate`, runs
 * the audit with the event renderer attached, then prints the report JSON when asked to.
 * Returns the exit code: 1 when any gate failed, 0 otherwise. Config/auth errors propagate.
 */
export async function runAuditCommand(opts: AuditCommandOptions, ctx: CommandContext): Promise<number> {
	const { deps, ui, prompter } = ctx;
	const { context } = deps;
	const machine = opts.ci === true || opts.json === true;
	const env = context.env;

	const targets = await listTargets(ctx, opts);
	if (opts.all) ui.line(copy.audit.targetsFound(targets.length));

	const gitInfo: GitInfo = await deps.git.info(context.cwd, env);
	let changedFiles: string[] | undefined;
	if (opts.changed) {
		if (!gitInfo.baseCommit) {
			ui.line(`${ui.colors.yellow("!")} ${copy.audit.changedNoGit}`);
		} else {
			changedFiles = await deps.git.changedFiles(context.cwd, env, gitInfo.baseCommit);
			if (!changedFiles || changedFiles.length === 0) {
				changedFiles = undefined;
				ui.line(`${ui.colors.yellow("!")} ${copy.audit.changedNone}`);
			} else {
				ui.line(
					ui.colors.dim(copy.audit.changedFiles(changedFiles.length, gitInfo.baseRef ?? gitInfo.baseCommit)),
				);
			}
		}
	}

	const runtimes = new Map<string, Promise<RuntimeLike>>();
	const runtimeFor = (agentDir: string) => {
		let runtime = runtimes.get(agentDir);
		if (!runtime) {
			runtime = deps.createModelRuntime({ agentDir, env });
			runtimes.set(agentDir, runtime);
		}
		return runtime;
	};

	const reports: Report[] = [];
	let failed = false;

	for (const target of targets) {
		const project = await deps.loadProject({ cwd: context.cwd, target, environment: opts.env, env });
		const agentDir = deps.gribbleAgentDir({ reusePiAuth: project.config.reusePiAuth, env });

		let model: ModelResolution | undefined;
		if (opts.mode !== "gate") {
			const spinner = ui.interactive ? prompter.spinner() : undefined;
			spinner?.start(copy.audit.resolvingModel);
			try {
				const runtime = await runtimeFor(agentDir);
				const settingsModel = await deps.readSettingsModel({ cwd: context.cwd, agentDir });
				model = await deps.resolveModel({ runtime, configured: project.config.model, settingsModel });
			} catch (err) {
				spinner?.error(copy.errors.auth);
				throw err;
			}
			spinner?.clear();
			if (model.warning) ui.line(`${ui.colors.yellow("!")} ${model.warning}`);
		} else {
			ui.debug(copy.audit.gateOnly);
		}

		const renderer = createEventRenderer({
			ui,
			mode: ui.interactive ? "tty" : "plain",
			spinner: ui.interactive ? prompter.spinner() : undefined,
			url: project.config.target.url,
			targetName: project.targetName,
			model: model
				? formatModelSpec({ provider: model.model.provider, id: model.model.id, thinking: model.thinking })
				: undefined,
		});
		renderer.start();

		const auditOptions: AuditOptionsWithModel = {
			project,
			mode: opts.mode,
			ci: opts.ci === true,
			agentDir,
			updateBaseline: opts.updateBaseline === true,
			onEvent: (event) => renderer.onEvent(event),
			signal: context.signal,
			routes: opts.routes,
			changedFiles,
			env,
			git: {
				commit: gitInfo.commit,
				branch: gitInfo.branch,
				baseCommit: gitInfo.baseCommit,
				remote: gitInfo.remote,
			},
			model,
		};

		let report: Report;
		try {
			report = await deps.runAudit(auditOptions);
		} catch (err) {
			renderer.abort(context.signal?.aborted ? copy.audit.interrupted : undefined);
			throw err;
		}

		const runDir = await locateRunDir(project, report);
		let reportPath: string | undefined;
		if (runDir) {
			reportPath = shortPath(context.cwd, join(runDir, "report.json"));
			if (opts.ci) {
				await writeFile(
					join(runDir, "gribble.sarif"),
					`${JSON.stringify(toSarif(report), null, 2)}\n`,
					"utf8",
				);
				await writeFile(join(runDir, "gribble-junit.xml"), toJUnit(report), "utf8");
			}
		} else {
			reportPath = shortPath(context.cwd, join(project.gribbleDir, "runs", "latest.json"));
		}

		renderer.finish(report, { reportPath, baselineUpdated: opts.updateBaseline });
		reports.push(report);
		if (report.summary.gate === "fail") failed = true;
		if (targets.length > 1) ui.line();
	}

	if (machine) {
		const payload = opts.all ? reports : reports[0];
		ui.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
	}

	return failed ? EXIT.gateFailed : EXIT.ok;
}
