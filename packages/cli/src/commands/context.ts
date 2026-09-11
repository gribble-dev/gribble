import { copy } from "../copy.js";
import type { CliDeps } from "../deps.js";
import { CliError, EXIT } from "../errors.js";
import type { Prompter } from "../prompts.js";
import { createUi, type Ui } from "../ui.js";

/** What every command receives: the injected deps, a configured Ui and a Prompter. */
export interface CommandContext {
	deps: CliDeps;
	ui: Ui;
	prompter: Prompter;
	verbose: boolean;
}

export interface CreateContextOptions {
	/** Route human output to stderr; no colors, no spinners, no prompts (`--ci`, `--json`). */
	machine?: boolean;
	verbose?: boolean;
}

export function createContext(deps: CliDeps, opts: CreateContextOptions = {}): CommandContext {
	const ui = createUi({ context: deps.context, machine: opts.machine, verbose: opts.verbose });
	const refuse = () => new CliError(copy.errors.promptInCi, { exitCode: EXIT.config });
	const prompter = deps.prompter(ui, refuse);
	return { deps, ui, prompter, verbose: opts.verbose === true };
}
