import type { Writable } from "node:stream";
import type { Option } from "@clack/prompts";
import * as clack from "@clack/prompts";
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
	}): Promise<string>;
	secret(opts: { message: string; placeholder?: string }): Promise<string>;
	confirm(opts: { message: string; initialValue?: boolean }): Promise<boolean>;
	select<V>(opts: { message: string; options: PromptOption<V>[]; initialValue?: V }): Promise<V>;
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

function unwrap<T>(value: T | symbol, cancelledMessage?: string): T {
	if (clack.isCancel(value)) throw new CancelledError(cancelledMessage);
	return value as T;
}

/** Prompter backed by @clack/prompts, writing to `output` (stdout normally). */
export function clackPrompter(output: Writable, opts: { cancelledMessage?: string } = {}): Prompter {
	const common = { output };
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
			return unwrap(await clack.password({ message: o.message, ...common }), cancelled);
		},
		async confirm(o) {
			return unwrap(await clack.confirm({ ...o, ...common }), cancelled);
		},
		async select<V>(o: { message: string; options: PromptOption<V>[]; initialValue?: V }) {
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
		spinner() {
			const s = clack.spinner({ ...common, withGuide: false });
			return {
				start: (m) => s.start(m),
				message: (m) => s.message(m),
				stop: (m) => s.stop(m),
				error: (m) => s.error(m),
				clear: () => s.clear(),
			};
		},
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
