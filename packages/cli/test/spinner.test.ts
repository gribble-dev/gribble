import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fitSpinnerMessage, rowSpinner } from "../src/prompts.js";

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

/** Captures writes; `frames()` is each spinner row as a terminal would show it, split on the `\r` that starts every frame. */
function fakeTty(columns: number) {
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
			.filter((f) => /^[◒◐◓◑] {2}/.test(f));
	return { out, chunks, frames };
}

describe("rowSpinner", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("never lets a frame exceed the terminal width, including after a resize", () => {
		const tty = fakeTty(120);
		const s = rowSpinner(tty.out);
		s.start(message);
		vi.advanceTimersByTime(3_000);
		const wideCount = tty.frames().length;
		tty.out.columns = 55;
		vi.advanceTimersByTime(1_000);
		s.stop("done");
		const frames = tty.frames();
		expect(wideCount).toBeGreaterThan(30);
		const wide = frames.slice(0, wideCount);
		const narrow = frames.slice(wideCount);
		expect(wide.some((f) => f.includes("$3.25)..."))).toBe(true);
		for (const f of narrow) expect([...f].length).toBeLessThanOrEqual(54);
		expect(narrow.every((f) => f.includes("$3…"))).toBe(true);
		expect(frames.some((f) => f.includes("\n"))).toBe(false);
	});

	it("cycles the dots, hides the cursor while spinning and restores it on stop", () => {
		const tty = fakeTty(80);
		const s = rowSpinner(tty.out);
		s.start("thinking...");
		vi.advanceTimersByTime(80 * 20);
		s.message("still thinking");
		vi.advanceTimersByTime(80 * 5);
		s.stop();
		const joined = tty.chunks.join("");
		expect(joined.startsWith("\x1b[?25l")).toBe(true);
		expect(joined.endsWith("\x1b[?25h")).toBe(true);
		const frames = tty.frames();
		expect(frames[0]).toMatch(/thinking$/);
		expect(frames.some((f) => /thinking\.\.\.$/.test(f))).toBe(true);
		expect(frames.at(-1)).toContain("still thinking");
		expect(stripAnsi(joined).trim().endsWith("◇  still thinking")).toBe(true);
	});

	it("clear() erases the row without printing a final line, and start() afterwards resumes", () => {
		const tty = fakeTty(80);
		const s = rowSpinner(tty.out);
		s.start("working");
		vi.advanceTimersByTime(200);
		s.clear();
		const afterClear = tty.chunks.length;
		vi.advanceTimersByTime(500);
		expect(tty.chunks.length).toBe(afterClear);
		expect(tty.chunks.at(-1)).toBe("\x1b[?25h");
		s.start("working");
		vi.advanceTimersByTime(200);
		expect(tty.chunks.length).toBeGreaterThan(afterClear);
		s.error("failed");
		expect(tty.chunks.join("")).toContain("▲  failed\n");
	});
});
