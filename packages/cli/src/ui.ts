import type { Writable } from "node:stream";
import pc from "picocolors";

/** The picocolors API, enabled or disabled. */
export type Colors = ReturnType<typeof pc.createColors>;

/** Where the CLI runs: streams, environment and terminal capabilities. Injected in tests. */
export interface RunContext {
	cwd: string;
	env: NodeJS.ProcessEnv;
	stdout: Writable;
	stderr: Writable;
	/** True when stdout is an interactive terminal. */
	isTTY: boolean;
	/** Abort signal wired to Ctrl+C by the bin. */
	signal?: AbortSignal;
}

export function defaultRunContext(): RunContext {
	return {
		cwd: process.cwd(),
		env: process.env,
		stdout: process.stdout,
		stderr: process.stderr,
		isTTY: Boolean(process.stdout.isTTY),
	};
}

/** Terminal output helper: a chosen stream, color support, and a couple of line writers. */
export interface Ui {
	readonly colors: Colors;
	/** Human-readable progress goes here: stdout normally, stderr in --ci/--json mode. */
	readonly out: Writable;
	/** The data channel (report JSON). */
	readonly stdout: Writable;
	/** Colors enabled and cursor movement acceptable (spinners). */
	readonly interactive: boolean;
	readonly verbose: boolean;
	write(text: string): void;
	line(text?: string): void;
	debug(text: string): void;
}

export interface UiOptions {
	context: RunContext;
	/** Route human output to stderr and disable colors and spinners (--ci). */
	machine?: boolean;
	verbose?: boolean;
}

/**
 * Colors are on only for an interactive terminal outside CI and without NO_COLOR.
 * `--ci` and `--json` route every human line to stderr so stdout stays a clean data channel.
 */
export function createUi(opts: UiOptions): Ui {
	const { context } = opts;
	const machine = opts.machine === true;
	const env = context.env;
	const noColor = env.NO_COLOR !== undefined && env.NO_COLOR !== "";
	const ci = env.CI !== undefined && env.CI !== "" && env.CI !== "false";
	const interactive = !machine && context.isTTY && !noColor && !ci;
	const colors = pc.createColors(interactive);
	const out = machine ? context.stderr : context.stdout;
	const verbose = opts.verbose === true;
	return {
		colors,
		out,
		stdout: context.stdout,
		interactive,
		verbose,
		write(text) {
			out.write(text);
		},
		line(text = "") {
			out.write(`${text}\n`);
		},
		debug(text) {
			if (verbose) out.write(`${colors.dim(text)}\n`);
		},
	};
}

/** Strip ANSI escape sequences; used when a colored string must be measured or compared. */
export function stripAnsi(text: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control characters by definition.
	return text.replace(/\[[0-9;]*m/g, "");
}
