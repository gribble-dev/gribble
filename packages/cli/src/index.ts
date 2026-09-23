import type { AuditMode } from "@gribble/core";
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import { parseRoutes, runAuditCommand } from "./commands/audit.js";
import { runBaselineUpdate } from "./commands/baseline.js";
import { type CommandContext, createContext } from "./commands/context.js";
import { runExplain } from "./commands/explain.js";
import { runIgnore } from "./commands/ignore.js";
import { runInit } from "./commands/init.js";
import { runInstall } from "./commands/install.js";
import { runLogin } from "./commands/login.js";
import { runLogout } from "./commands/logout.js";
import { runModels } from "./commands/models.js";
import { runVersion } from "./commands/version.js";
import { copy } from "./copy.js";
import { type CliDeps, type DepsOverrides, mergeDeps } from "./deps.js";
import {
	CancelledError,
	CliError,
	EXIT,
	errorMessage,
	isAuthError,
	isConfigError,
	isNoModelError,
	isReviewRuntimeMissingError,
} from "./errors.js";

export type { AuditCommandOptions } from "./commands/audit.js";
export type { ExplainCommandOptions } from "./commands/explain.js";
export { addIgnoredFingerprint } from "./commands/ignore.js";
export type { InitOptions } from "./commands/init.js";
export { copy } from "./copy.js";
export {
	type AuditOptionsWithModel,
	type CliDeps,
	type DepsOverrides,
	defaultDeps,
	mergeDeps,
} from "./deps.js";
export { CancelledError, CliError, EXIT } from "./errors.js";
export { createGitApi, type GitApi, type GitExec, type GitInfo } from "./git.js";
export { clackPrompter, type Prompter, type PromptSpinner, plainPrompter } from "./prompts.js";
export { listProviders, type ProviderInfo, type RuntimeLike } from "./providers.js";
export { createEventRenderer, type EventRenderer, type RendererOptions } from "./render/index.js";
export { createUi, type RunContext, type Ui } from "./ui.js";
export { CLI_VERSION } from "./version.js";

const MODES: AuditMode[] = ["gate", "review", "all"];

function parseMode(value: string): AuditMode {
	if ((MODES as string[]).includes(value)) return value as AuditMode;
	throw new InvalidArgumentError(`expected one of ${MODES.join(", ")}`);
}

interface GlobalOptions {
	verbose?: boolean;
}

function buildProgram(deps: CliDeps, setExit: (code: number) => void): Command {
	const program = new Command("gribble")
		.description(copy.program.description)
		.version(deps.version, "-V, --version")
		.option("--verbose", copy.program.verbose)
		.exitOverride()
		.configureOutput({
			writeOut: (str) => deps.context.stdout.write(str),
			writeErr: (str) => deps.context.stderr.write(str),
		})
		.showHelpAfterError(true)
		.enablePositionalOptions();

	const ctxFor = (cmd: Command, machine = false): CommandContext => {
		const globals = cmd.optsWithGlobals<GlobalOptions>();
		return createContext(deps, { machine, verbose: globals.verbose === true });
	};

	program
		.command("init")
		.description(copy.init.description)
		.option("-y, --yes", "Accept every default; non-interactive.")
		.option("--update-skills", "Only refresh installed agent skill files.")
		.option("--url <url>", "Target URL. Skips that question.")
		.option("--start <cmd>", "Dev server start command. Skips that question.")
		.option("--model <provider/id>", "Model in pi syntax. Skips model selection.")
		.option("--force", "Overwrite existing .gribble/ files and skill files.")
		.action(async function (this: Command, options) {
			setExit(await runInit(options, ctxFor(this)));
		});

	program
		.command("audit")
		.description(copy.audit.description)
		.addOption(new Option("--mode <mode>", copy.audit.modeOption).default("all").argParser(parseMode))
		.option("--ci", copy.audit.ciOption)
		.option("--target <dir>", copy.audit.targetOption)
		.option("--all", copy.audit.allOption)
		.option("--env <name>", copy.audit.envOption)
		.option("--update-baseline", copy.audit.updateBaselineOption)
		.option("--json", copy.audit.jsonOption)
		.option("--routes <list>", copy.audit.routesOption)
		.option("--changed", copy.audit.changedOption)
		.action(async function (this: Command, options) {
			const machine = options.ci === true || options.json === true;
			setExit(
				await runAuditCommand({ ...options, routes: parseRoutes(options.routes) }, ctxFor(this, machine)),
			);
		});

	program
		.command("login")
		.description(copy.login.description)
		.argument("[provider]", "Provider id, e.g. anthropic, openai, google.")
		.option("--api-key <key>", copy.login.apiKeyOption)
		.action(async function (this: Command, provider: string | undefined, options) {
			setExit(await runLogin(provider, options, ctxFor(this)));
		});

	program
		.command("logout")
		.description(copy.logout.description)
		.argument("[provider]", "Provider id. Omit to remove every stored credential.")
		.action(async function (this: Command, provider: string | undefined) {
			setExit(await runLogout(provider, {}, ctxFor(this)));
		});

	program
		.command("models")
		.description(copy.models.description)
		.action(async function (this: Command) {
			setExit(await runModels({}, ctxFor(this)));
		});

	program
		.command("install")
		.description(copy.install.description)
		.option("--with-deps", copy.install.withDepsOption)
		.action(async function (this: Command, options) {
			setExit(await runInstall(options, ctxFor(this)));
		});

	program
		.command("ignore")
		.description(copy.ignore.description)
		.argument("<fingerprint>", "16-character finding fingerprint from the report.")
		.option("--target <dir>", copy.ignore.targetOption)
		.action(async function (this: Command, fingerprint: string, options) {
			setExit(await runIgnore(fingerprint, options, ctxFor(this)));
		});

	program
		.command("explain")
		.description(copy.explain.description)
		.argument("<rule>", "Rule id, e.g. links/broken.")
		.option("--env <name>", copy.audit.envOption)
		.action(async function (this: Command, rule: string, options) {
			setExit(await runExplain(rule, options, ctxFor(this)));
		});

	const baseline = program.command("baseline").description(copy.baseline.description);
	baseline
		.command("update")
		.description(copy.baseline.updateDescription)
		.addOption(new Option("--mode <mode>", copy.audit.modeOption).default("gate").argParser(parseMode))
		.option("--target <dir>", copy.audit.targetOption)
		.option("--all", copy.audit.allOption)
		.option("--env <name>", copy.audit.envOption)
		.option("--json", copy.audit.jsonOption)
		.option("--ci", copy.audit.ciOption)
		.action(async function (this: Command, options) {
			const machine = options.ci === true || options.json === true;
			setExit(await runBaselineUpdate(options, ctxFor(this, machine)));
		});

	program
		.command("version")
		.description(copy.version.description)
		.action(function (this: Command) {
			setExit(runVersion(ctxFor(this)));
		});

	return program;
}

/** The dev server's last lines, carried on DevServerError and TargetGoneError as `output`. */
function writeServerOutput(err: Error, write: (line: string) => void): void {
	const output = (err as { output?: unknown }).output;
	if (!Array.isArray(output) || output.length === 0) return;
	write(copy.errors.devServerOutput(output.length));
	for (const line of output) write(`  | ${String(line)}`);
}

/** Print an error the way the docs promise and return the exit code for it. */
function reportError(err: unknown, deps: CliDeps, verbose: boolean): number {
	const { stderr } = deps.context;
	const write = (line: string) => stderr.write(`${line}\n`);
	if (err instanceof CancelledError) {
		write(err.message);
		return err.exitCode;
	}
	if (err instanceof CliError) {
		write(`error: ${err.message}`);
		if (err.hint) write(err.hint);
		if (verbose && err.stack) write(err.stack);
		return err.exitCode;
	}
	if (isConfigError(err)) {
		write(`error: ${errorMessage(err)}`);
		write(copy.errors.configHint);
		return EXIT.config;
	}
	if (isReviewRuntimeMissingError(err)) {
		write(`error: ${errorMessage(err)}`);
		write(copy.errors.reviewRuntimeHint);
		return EXIT.config;
	}
	if (isAuthError(err)) {
		write(`error: ${errorMessage(err)}`);
		write(isNoModelError(err) ? copy.errors.noModelHint : copy.errors.authHint);
		return EXIT.config;
	}
	if (err instanceof Error && err.name === "AbortError") {
		write(copy.audit.interrupted);
		return EXIT.cancelled;
	}
	if (err instanceof Error && err.name === "DevServerError") {
		write(`error: ${err.message}`);
		writeServerOutput(err, write);
		write(copy.errors.devServerHint);
		return EXIT.config;
	}
	if (err instanceof Error && err.name === "TargetGoneError") {
		write(`error: ${err.message}`);
		writeServerOutput(err, write);
		write(copy.errors.targetGoneHint);
		return EXIT.targetGone;
	}
	write(`${copy.errors.unexpected} ${errorMessage(err)}`);
	if (verbose && err instanceof Error && err.stack) write(err.stack);
	else write(copy.errors.unexpectedHint);
	return EXIT.crash;
}

/**
 * Run the CLI with `argv` (without `node` and the script path) and return the exit code.
 * `overrides` replaces any dependency; see {@link CliDeps}.
 */
export async function run(argv: string[], overrides: DepsOverrides = {}): Promise<number> {
	const deps = mergeDeps(overrides);
	let exitCode: number = EXIT.ok;
	const program = buildProgram(deps, (code) => {
		exitCode = code;
	});
	const verbose = argv.includes("--verbose");
	try {
		await program.parseAsync(argv, { from: "user" });
		return exitCode;
	} catch (err) {
		if (err instanceof CommanderError) {
			if (
				err.code === "commander.helpDisplayed" ||
				err.code === "commander.version" ||
				err.code === "commander.help"
			) {
				return EXIT.ok;
			}
			// Commander already printed the usage error; it is a setup problem, not a gate failure.
			return EXIT.config;
		}
		return reportError(err, deps, verbose);
	}
}
