import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import type { ActionInputs } from "./inputs.js";
import { findGribbleDirs, loadLatestReport, parseReportJson, ReportError } from "./report.js";
import type { LoadedReport, Report } from "./types.js";

export interface GribbleCommand {
	command: string;
	/** Arguments placed before `audit` (e.g. `--yes gribble` for npx). */
	prefixArgs: string[];
	how: "working-directory" | "repo-root" | "npx";
}

function binName(): string {
	return process.platform === "win32" ? "gribble.cmd" : "gribble";
}

/**
 * Locate the `gribble` binary: the audited app's own `node_modules/.bin`, then
 * the repository root's, else `npx --yes gribble`.
 */
export function resolveGribbleCommand(opts: {
	workingDirectory: string;
	repoRoot: string;
	exists?: (p: string) => boolean;
}): GribbleCommand {
	const exists = opts.exists ?? existsSync;
	const local = path.join(opts.workingDirectory, "node_modules", ".bin", binName());
	if (exists(local)) return { command: local, prefixArgs: [], how: "working-directory" };
	const root = path.join(opts.repoRoot, "node_modules", ".bin", binName());
	if (exists(root)) return { command: root, prefixArgs: [], how: "repo-root" };
	return {
		command: process.platform === "win32" ? "npx.cmd" : "npx",
		prefixArgs: ["--yes", "gribble"],
		how: "npx",
	};
}

/** `audit --ci --mode <mode> [--target <dir>] [--all] [--env <name>] [--update-baseline]` */
export function buildAuditArgs(
	inputs: Pick<ActionInputs, "mode" | "target" | "all" | "environment" | "updateBaseline">,
): string[] {
	const args = ["audit", "--ci", "--mode", inputs.mode];
	if (inputs.target) args.push("--target", inputs.target);
	if (inputs.all) args.push("--all");
	if (inputs.environment) args.push("--env", inputs.environment);
	if (inputs.updateBaseline) args.push("--update-baseline");
	return args;
}

export interface AuditRun {
	exitCode: number;
	command: string;
	loaded: LoadedReport[];
	/** Reports parsed from stdout, used only when latest.json is missing. */
	stdoutReports: Report[];
}

/** Extract the last JSON document (object or array) printed on stdout. */
export function extractStdoutJson(stdout: string): unknown {
	const trimmed = stdout.trim();
	if (!trimmed) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		// Progress may have leaked to stdout; take the last top-level `{` or `[`.
		for (const open of ["{", "["]) {
			let idx = trimmed.lastIndexOf(`\n${open}`);
			while (idx !== -1) {
				try {
					return JSON.parse(trimmed.slice(idx + 1));
				} catch {
					idx = trimmed.lastIndexOf(`\n${open}`, idx - 1);
				}
			}
		}
		return undefined;
	}
}

export class AuditError extends Error {
	constructor(
		message: string,
		readonly exitCode: number,
	) {
		super(message);
		this.name = "AuditError";
	}
}

export async function runAudit(
	inputs: ActionInputs,
	opts: { workingDirectory: string; repoRoot: string },
): Promise<AuditRun> {
	const cmd = resolveGribbleCommand(opts);
	const args = [...cmd.prefixArgs, ...buildAuditArgs(inputs)];
	const display = `${cmd.command} ${args.join(" ")}`;
	core.info(`🐛 ${display}  (cwd: ${opts.workingDirectory}, binary via ${cmd.how})`);
	if (cmd.how === "npx") {
		core.warning(
			"`gribble` is not installed in this repository; falling back to `npx --yes gribble`. Add it as a devDependency for reproducible runs.",
		);
	}
	const startedAt = Date.now();

	let stdout = "";
	const exitCode = await exec.exec(cmd.command, args, {
		cwd: opts.workingDirectory,
		ignoreReturnCode: true,
		silent: true,
		env: { ...(process.env as Record<string, string>), CI: "true", GRIBBLE_CI: "1" },
		listeners: {
			stdout: (data) => {
				stdout += data.toString();
			},
			stderr: (data) => {
				process.stderr.write(data);
			},
		},
	});

	if (exitCode !== 0 && exitCode !== 1) {
		const hint =
			exitCode === 2
				? "gribble reported a configuration or authentication error (exit 2). Check .gribble/gribble.yaml and the model API key secret."
				: `gribble crashed with exit code ${exitCode}.`;
		throw new AuditError(hint, exitCode);
	}
	core.info(exitCode === 0 ? "gribble exited with 0 (gate passed)." : "gribble exited with 1 (gate failed).");

	const stdoutJson = extractStdoutJson(stdout);
	const stdoutReports: Report[] = [];
	if (Array.isArray(stdoutJson)) {
		for (const item of stdoutJson) {
			try {
				stdoutReports.push(parseReportJson(JSON.stringify(item), "stdout"));
			} catch (error) {
				core.debug(`Ignoring stdout item: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	} else if (stdoutJson !== undefined) {
		try {
			stdoutReports.push(parseReportJson(JSON.stringify(stdoutJson), "stdout"));
		} catch (error) {
			core.debug(`Ignoring stdout JSON: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	const loaded = await loadReports(inputs, opts.workingDirectory, startedAt, stdoutReports, exitCode);
	return { exitCode, command: display, loaded, stdoutReports };
}

async function loadReports(
	inputs: ActionInputs,
	workingDirectory: string,
	startedAt: number,
	stdoutReports: Report[],
	exitCode: number,
): Promise<LoadedReport[]> {
	const gribbleDirs: string[] = [];
	if (inputs.all) {
		for (const dir of await findGribbleDirs(workingDirectory)) {
			const latest = path.join(dir, "runs", "latest.json");
			try {
				const stat = await fs.stat(latest);
				// Only targets touched by this run; a root `.gribble/` with shared rules has no runs.
				if (stat.mtimeMs >= startedAt - 5_000) gribbleDirs.push(dir);
			} catch {
				// no report for this target
			}
		}
	} else {
		gribbleDirs.push(
			path.join(inputs.target ? path.resolve(workingDirectory, inputs.target) : workingDirectory, ".gribble"),
		);
	}

	const loaded: LoadedReport[] = [];
	for (const dir of gribbleDirs) {
		try {
			loaded.push(await loadLatestReport(dir));
		} catch (error) {
			if (error instanceof ReportError) throw error;
			core.warning(
				`Could not read ${path.join(dir, "runs", "latest.json")}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	if (loaded.length > 0) return loaded;

	if (stdoutReports.length > 0) {
		core.warning("No runs/latest.json found; using the report printed on stdout.");
		return stdoutReports.map((report) => {
			const gribbleDir = path.join(workingDirectory, ".gribble");
			return {
				report,
				path: path.join(gribbleDir, "runs", "latest.json"),
				gribbleDir,
				targetDir: workingDirectory,
			};
		});
	}
	const expected = gribbleDirs.map((d) => path.join(d, "runs", "latest.json")).join(" or ");
	throw new ReportError(
		exitCode === 1
			? `gribble exited with 1 but wrote no report (expected ${expected}). The audit probably did not start; see the log above.`
			: `No report found. Expected ${expected}. Did \`gribble init\` run in this directory?`,
	);
}
