import type { Readable, Writable } from "node:stream";
import type { Option } from "@clack/prompts";
import * as clack from "@clack/prompts";
import pc from "picocolors";
import { CancelledError } from "./errors.js";

export interface PromptOption<V> {
	value: V;
	label: string;
	hint?: string;
}

/**
 * The handful of interactions the CLI needs. `clackPrompter` is the real one; tests inject a
 * scripted implementation. Every prompt throws {@link CancelledError} on Ctrl+C.
 */
export interface Prompter {
	intro(title: string): void;
	outro(message: string): void;
	note(message: string, title?: string): void;
	info(message: string): void;
	success(message: string): void;
	warn(message: string): void;
	error(message: string): void;
	step(message: string): void;
	text(opts: {
		message: string;
		placeholder?: string;
		defaultValue?: string;
		initialValue?: string;
		/** Aborting cancels the prompt as if the user had pressed Ctrl+C. */
		signal?: AbortSignal;
	}): Promise<string>;
	secret(opts: { message: string; placeholder?: string; signal?: AbortSignal }): Promise<string>;
	confirm(opts: { message: string; initialValue?: boolean }): Promise<boolean>;
	select<V>(opts: {
		message: string;
		options: PromptOption<V>[];
		initialValue?: V;
		signal?: AbortSignal;
	}): Promise<V>;
	multiselect<V>(opts: {
		message: string;
		options: PromptOption<V>[];
		initialValues?: V[];
		required?: boolean;
	}): Promise<V[]>;
	spinner(): PromptSpinner;
}

export interface PromptSpinner {
	start(message?: string): void;
	message(message?: string): void;
	stop(message?: string): void;
	error(message?: string): void;
	/** Erase the spinner line without printing anything; used to interleave output. */
	clear(): void;
}

/** Width the spinner adds around a message: frame glyph, two spaces, up to three dots, plus one column so the row never sits exactly at the terminal edge. */
const SPINNER_CHROME = 3 + 3 + 1;

/** Truncate a spinner message so the rendered row fits in `columns`; 80 when the stream has no width. */
export function fitSpinnerMessage(message: string, columns: number | undefined): string {
	const width = (columns ?? 80) - SPINNER_CHROME;
	if (width <= 1 || message.length <= width) return message;
	return `${message.slice(0, width - 1)}…`;
}

const SPINNER_FRAMES = clack.unicode ? ["◒", "◐", "◓", "◑"] : ["•", "o", "O", "0"];
const SPINNER_DELAY = clack.unicode ? 80 : 120;
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const ERASE_ROW = "\r\x1b[2K";

/**
 * A single-row spinner in clack's style. clack's own spinner sizes its erase from the bare
 * message and from the terminal width at creation time, so a message that wraps once the frame
 * and dots are added, or a terminal resized mid-run, leaves a stale row behind every tick
 * (https://github.com/bombshell-dev/clack/pull/478, deferred to the rework in #479). This one
 * re-fits the message to the live width on every frame, so the row never wraps and erasing it
 * is just `\r` plus clear-line.
 */
export function rowSpinner(output: Writable): PromptSpinner {
	const stream = output as Writable & { columns?: number };
	let timer: NodeJS.Timeout | undefined;
	let text = "";
	let frame = 0;
	let dots = 0;
	const showCursor = () => output.write(SHOW_CURSOR);

	const render = () => {
		const glyph = pc.magenta(SPINNER_FRAMES[frame] ?? "");
		const trail = ".".repeat(Math.min(3, Math.floor(dots)));
		output.write(`${ERASE_ROW}${glyph}  ${fitSpinnerMessage(text, stream.columns)}${trail}`);
		frame = (frame + 1) % SPINNER_FRAMES.length;
		dots = dots < 4 ? dots + 0.125 : 0;
	};

	const finish = (line?: string) => {
		if (!timer) return;
		clearInterval(timer);
		timer = undefined;
		process.removeListener("exit", showCursor);
		output.write(ERASE_ROW);
		if (line !== undefined) output.write(`${line}\n`);
		showCursor();
	};

	return {
		start(message = "") {
			text = message.replace(/\.+$/, "");
			if (timer) return;
			frame = 0;
			dots = 0;
			process.once("exit", showCursor);
			output.write(HIDE_CURSOR);
			render();
			timer = setInterval(render, SPINNER_DELAY);
		},
		message(message = "") {
			text = message.replace(/\.+$/, "");
		},
		stop(message = "") {
			finish(`${pc.green(clack.S_STEP_SUBMIT)}  ${message || text}`);
		},
		error(message = "") {
			finish(`${pc.red(clack.S_STEP_ERROR)}  ${message || text}`);
		},
		clear() {
			finish();
		},
	};
}

function unwrap<T>(value: T | symbol, cancelledMessage?: string): T {
	if (clack.isCancel(value)) throw new CancelledError(cancelledMessage);
	return value as T;
}

/** Prompter backed by @clack/prompts, writing to `output` (stdout normally). Tests pass `input`. */
export function clackPrompter(
	output: Writable,
	opts: { cancelledMessage?: string; input?: Readable } = {},
): Prompter {
	const common = opts.input ? { output, input: opts.input } : { output };
	const cancelled = opts.cancelledMessage;
	return {
		intro: (title) => clack.intro(title, common),
		outro: (message) => clack.outro(message, common),
		note: (message, title) => clack.note(message, title, common),
		info: (message) => clack.log.info(message, common),
		success: (message) => clack.log.success(message, common),
		warn: (message) => clack.log.warn(message, common),
		error: (message) => clack.log.error(message, common),
		step: (message) => clack.log.step(message, common),
		async text(o) {
			return unwrap(await clack.text({ ...o, ...common }), cancelled);
		},
		async secret(o) {
			return unwrap(await clack.password({ message: o.message, signal: o.signal, ...common }), cancelled);
		},
		async confirm(o) {
			return unwrap(await clack.confirm({ ...o, ...common }), cancelled);
		},
		async select<V>(o: {
			message: string;
			options: PromptOption<V>[];
			initialValue?: V;
			signal?: AbortSignal;
		}) {
			return unwrap(await clack.select({ ...o, options: o.options as Option<V>[], ...common }), cancelled);
		},
		async multiselect<V>(o: {
			message: string;
			options: PromptOption<V>[];
			initialValues?: V[];
			required?: boolean;
		}) {
			return unwrap(
				await clack.multiselect({ ...o, options: o.options as Option<V>[], ...common }),
				cancelled,
			);
		},
		spinner: () => rowSpinner(output),
	};
}

/**
 * Prompter for non-interactive runs (`--ci`, no TTY): informational calls print plain lines,
 * every question throws so nothing ever blocks waiting for a keyboard.
 */
export function plainPrompter(output: Writable, refuse: () => Error): Prompter {
	const line = (prefix: string, message: string) => {
		for (const l of message.split("\n")) output.write(`${prefix}${l}\n`);
	};
	const noPrompt = async (): Promise<never> => {
		throw refuse();
	};
	return {
		intro: (title) => line("", title),
		outro: (message) => line("", message),
		note: (message, title) => line("", title ? `${title}\n${message}` : message),
		info: (message) => line("", message),
		success: (message) => line("", message),
		warn: (message) => line("warning: ", message),
		error: (message) => line("error: ", message),
		step: (message) => line("", message),
		text: noPrompt,
		secret: noPrompt,
		confirm: noPrompt,
		select: noPrompt,
		multiselect: noPrompt,
		spinner() {
			return {
				start: (m) => m && line("", m),
				message: (m) => m && line("", m),
				stop: (m) => m && line("", m),
				error: (m) => m && line("error: ", m),
				clear: () => {},
			};
		},
	};
}
