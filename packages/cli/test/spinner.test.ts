import { execFileSync } from "node:child_process";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import * as clack from "@clack/prompts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ASCII_SPINNER_STYLE,
	fitSpinnerMessage,
	rowSpinner,
	SPINNER_STYLE,
	type SpinnerStyle,
	UNICODE_SPINNER_STYLE,
} from "../src/prompts.js";

const message = "reviewing (55/200 steps · 1.2M/2.0M tokens · $3.25)";

describe("fitSpinnerMessage", () => {
	it("leaves a message alone when it fits with the frame and dots", () => {
		expect(fitSpinnerMessage(message, 80)).toBe(message);
		expect(fitSpinnerMessage(message, message.length + 7)).toBe(message);
	});

	it("truncates a message that would wrap once the frame and dots are added", () => {
		const fitted = fitSpinnerMessage(message, 55);
		expect(fitted).toBe("reviewing (55/200 steps · 1.2M/2.0M tokens · $3…");
		expect(fitted.length + 7).toBeLessThanOrEqual(55);
	});

	it("assumes 80 columns when the stream has none, and never truncates to nothing", () => {
		expect(fitSpinnerMessage("x".repeat(100), undefined)).toHaveLength(73);
		expect(fitSpinnerMessage(message, 4)).toBe(message);
	});
});

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

/** Captures writes; `frames()` is each spinner row of `style` as a terminal would show it, split on the `\r` that starts every frame. */
function fakeTty(columns: number, style: SpinnerStyle) {
	const chunks: string[] = [];
	const out = new Writable({
		write(chunk, _enc, cb) {
			chunks.push(chunk.toString());
			cb();
		},
	}) as Writable & { columns: number };
	out.columns = columns;
	const frames = () =>
		chunks
			.join("")
			.split("\r")
			.map(stripAnsi)
			.filter((f) => style.frames.some((glyph) => f.startsWith(`${glyph}  `)));
	return { out, chunks, frames };
}

/**
 * Both styles are exercised, whatever this terminal reports: the ASCII fallback renders for real
 * users too, and timings are expressed in `style.delay` so a slower style still yields the same frames.
 */
describe.each([
	["unicode", UNICODE_SPINNER_STYLE],
	["ascii", ASCII_SPINNER_STYLE],
] as const)("rowSpinner (%s)", (_label, style) => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("never lets a frame exceed the terminal width, including after a resize", () => {
		const tty = fakeTty(120, style);
		const s = rowSpinner(tty.out, style);
		s.start(message);
		vi.advanceTimersByTime(style.delay * 40);
		const wideCount = tty.frames().length;
		tty.out.columns = 55;
		vi.advanceTimersByTime(style.delay * 12);
		const frames = tty.frames();
		s.stop("done");
		expect(wideCount).toBeGreaterThan(30);
		const wide = frames.slice(0, wideCount);
		const narrow = frames.slice(wideCount);
		expect(wide.some((f) => f.includes("$3.25)..."))).toBe(true);
		for (const f of narrow) expect([...f].length).toBeLessThanOrEqual(54);
		expect(narrow.every((f) => f.includes("$3…"))).toBe(true);
		expect(frames.some((f) => f.includes("\n"))).toBe(false);
	});

	it("cycles the dots, hides the cursor while spinning and restores it on stop", () => {
		const tty = fakeTty(80, style);
		const s = rowSpinner(tty.out, style);
		s.start("thinking...");
		vi.advanceTimersByTime(style.delay * 20);
		s.message("still thinking");
		vi.advanceTimersByTime(style.delay * 5);
		const frames = tty.frames();
		s.stop();
		const joined = tty.chunks.join("");
		expect(joined.startsWith("\x1b[?25l")).toBe(true);
		expect(joined.endsWith("\x1b[?25h")).toBe(true);
		expect(frames[0]).toMatch(/thinking$/);
		expect(frames.some((f) => /thinking\.\.\.$/.test(f))).toBe(true);
		expect(frames.at(-1)).toContain("still thinking");
		expect(stripAnsi(joined).trim().endsWith(`${style.submit}  still thinking`)).toBe(true);
	});

	it("clear() erases the row without printing a final line, and start() afterwards resumes", () => {
		const tty = fakeTty(80, style);
		const s = rowSpinner(tty.out, style);
		s.start("working");
		vi.advanceTimersByTime(style.delay * 2);
		s.clear();
		const afterClear = tty.chunks.length;
		vi.advanceTimersByTime(style.delay * 5);
		expect(tty.chunks.length).toBe(afterClear);
		expect(tty.chunks.at(-1)).toBe("\x1b[?25h");
		s.start("working");
		vi.advanceTimersByTime(style.delay * 2);
		expect(tty.chunks.length).toBeGreaterThan(afterClear);
		s.error("failed");
		expect(stripAnsi(tty.chunks.join(""))).toContain(`${style.error}  failed\n`);
	});
});

/** Asks a fresh node, with `TERM` set, which symbols clack picks there. Lets one run check both modes, since clack decides once at import. */
function clackSymbols(term: string): { unicode: boolean; submit: string; error: string } {
	const script =
		'import * as clack from "@clack/prompts";' +
		"process.stdout.write(JSON.stringify({ unicode: clack.unicode, submit: clack.S_STEP_SUBMIT, error: clack.S_STEP_ERROR }));";
	const out = execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
		cwd: fileURLToPath(new URL("..", import.meta.url)),
		env: { ...process.env, TERM: term },
		encoding: "utf8",
	});
	return JSON.parse(out);
}

describe("SPINNER_STYLE", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("follows clack's unicode decision, so the final row matches the CLI's other step lines", () => {
		expect(SPINNER_STYLE).toBe(clack.unicode ? UNICODE_SPINNER_STYLE : ASCII_SPINNER_STYLE);
		expect(SPINNER_STYLE.submit).toBe(clack.S_STEP_SUBMIT);
		expect(SPINNER_STYLE.error).toBe(clack.S_STEP_ERROR);
	});

	// The mode this suite happens to run in only checks one table; a terminal clack reads differently checks the other.
	it.each(["xterm-256color", "linux"])("matches clack's symbols under TERM=%s", (term) => {
		const clackUnderTerm = clackSymbols(term);
		const style = clackUnderTerm.unicode ? UNICODE_SPINNER_STYLE : ASCII_SPINNER_STYLE;
		expect({ submit: clackUnderTerm.submit, error: clackUnderTerm.error }).toEqual({
			submit: style.submit,
			error: style.error,
		});
	});

	it("is what rowSpinner renders when no style is passed", () => {
		const tty = fakeTty(80, SPINNER_STYLE);
		const s = rowSpinner(tty.out);
		s.start("working");
		s.clear();
		expect(stripAnsi(tty.chunks.join(""))).toContain(`${SPINNER_STYLE.frames[0]}  working`);
	});
});
