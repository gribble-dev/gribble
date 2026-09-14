import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type Document, isMap, isPair, isScalar, isSeq, type Pair, parseDocument, type YAMLSeq } from "yaml";
import { copy } from "../copy.js";
import { CliError, EXIT } from "../errors.js";
import { displayPath } from "../paths.js";
import type { CommandContext } from "./context.js";

export interface IgnoreOptions {
	target?: string;
}

const FINGERPRINT = /^[0-9a-f]{16}$/;

function ignorePair(doc: Document): Pair | undefined {
	if (!isMap(doc.contents)) return undefined;
	return doc.contents.items.find((p) => isPair(p) && isScalar(p.key) && p.key.value === "ignore");
}

function seqValues(seq: YAMLSeq): string[] {
	return seq.items.map((item) => (isScalar(item) ? String(item.value) : String(item)));
}

function lineStartOf(text: string, index: number): number {
	return text.lastIndexOf("\n", index - 1) + 1;
}

function lineEndOf(text: string, index: number): number {
	const nl = text.indexOf("\n", index);
	return nl === -1 ? text.length : nl;
}

function leadingWhitespace(line: string): string {
	return /^[ \t]*/.exec(line)?.[0] ?? "";
}

/**
 * Insert `fingerprint` into `ignore:` by editing the source text at the positions yaml reports,
 * so every other byte (comments, alignment, flow style elsewhere) survives untouched.
 * Returns undefined when the document shape is one this editor does not handle.
 */
export function spliceIgnore(
	text: string,
	fingerprint: string,
): { text: string; status: "added" | "already" } | undefined {
	const doc = parseDocument(text);
	if (doc.errors.length > 0 || (doc.contents !== null && !isMap(doc.contents))) return undefined;
	const pair = ignorePair(doc);
	if (!pair) {
		const body = text.length === 0 || text.endsWith("\n") ? text : `${text}\n`;
		return { text: `${body}ignore:\n  - ${fingerprint}\n`, status: "added" };
	}
	if (!isScalar(pair.key) || !pair.key.range) return undefined;
	const keyLineStart = lineStartOf(text, pair.key.range[0]);
	const itemIndent = `${leadingWhitespace(text.slice(keyLineStart, pair.key.range[0]))}  `;
	const value = pair.value;

	if (isSeq(value)) {
		if (seqValues(value).includes(fingerprint)) return { text, status: "already" };
		if (!value.range) return undefined;
		if (value.flow) {
			const [start, end] = value.range;
			if (value.items.length === 0) {
				// `ignore: []   # comment` -> `ignore:   # comment` + a block item on the next line.
				const withoutBrackets = text.slice(0, start) + text.slice(end);
				const insertAt = lineEndOf(withoutBrackets, start);
				return {
					text: `${withoutBrackets.slice(0, insertAt)}\n${itemIndent}- ${fingerprint}${withoutBrackets.slice(insertAt)}`,
					status: "added",
				};
			}
			const close = text.lastIndexOf("]", end);
			if (close < start) return undefined;
			return { text: `${text.slice(0, close)}, ${fingerprint}${text.slice(close)}`, status: "added" };
		}
		const last = value.items[value.items.length - 1] as { range?: [number, number, number] } | undefined;
		if (!last?.range) return undefined;
		const first = value.items[0] as { range?: [number, number, number] };
		const firstLineStart = first.range ? lineStartOf(text, first.range[0]) : keyLineStart;
		const indent = first.range ? leadingWhitespace(text.slice(firstLineStart, first.range[0])) : itemIndent;
		let insertAt = last.range[2];
		let prefix = "";
		if (text[insertAt - 1] !== "\n") {
			insertAt = lineEndOf(text, insertAt);
			prefix = "\n";
		}
		const suffix = text[insertAt - 1] === "\n" || prefix ? "\n" : "";
		const line = `${prefix}${indent}- ${fingerprint}${suffix}`;
		return { text: `${text.slice(0, insertAt)}${line}${text.slice(insertAt)}`, status: "added" };
	}

	if (value === null || (isScalar(value) && value.value === null)) {
		// `ignore:` with nothing after it (possibly a comment on the same line).
		const insertAt = lineEndOf(text, pair.key.range[1]);
		return {
			text: `${text.slice(0, insertAt)}\n${itemIndent}- ${fingerprint}${text.slice(insertAt)}`,
			status: "added",
		};
	}
	return undefined;
}

function verify(text: string, fingerprint: string): boolean {
	const doc = parseDocument(text);
	if (doc.errors.length > 0) return false;
	const value = doc.get("ignore", true);
	return isSeq(value) && seqValues(value).includes(fingerprint);
}

/**
 * Append a fingerprint to `ignore:` in rules.yaml, keeping comments and formatting. Text splicing
 * first; the yaml Document API (which preserves comments but normalizes whitespace) as a fallback.
 * Returns `"added"` or `"already"`.
 */
export async function addIgnoredFingerprint(
	rulesPath: string,
	fingerprint: string,
): Promise<"added" | "already"> {
	const text = await readFile(rulesPath, "utf8");
	const spliced = spliceIgnore(text, fingerprint);
	if (spliced?.status === "already") return "already";
	if (spliced && verify(spliced.text, fingerprint)) {
		await writeFile(rulesPath, spliced.text, "utf8");
		return "added";
	}
	const doc = parseDocument(text);
	const current = doc.get("ignore", true);
	if (isSeq(current)) {
		if (seqValues(current).includes(fingerprint)) return "already";
		if (current.items.length === 0) current.flow = false;
		current.add(fingerprint);
	} else {
		doc.set("ignore", [fingerprint]);
	}
	await writeFile(rulesPath, doc.toString(), "utf8");
	return "added";
}

export async function runIgnore(
	fingerprint: string,
	opts: IgnoreOptions,
	ctx: CommandContext,
): Promise<number> {
	const { ui, deps } = ctx;
	const fp = fingerprint.trim().toLowerCase();
	if (!FINGERPRINT.test(fp)) {
		throw new CliError(copy.ignore.invalidFingerprint(fingerprint), { exitCode: EXIT.config });
	}
	const targetDir = resolve(deps.context.cwd, opts.target ?? ".");
	const rulesPath = join(targetDir, ".gribble", "rules.yaml");
	let status: "added" | "already";
	try {
		status = await addIgnoredFingerprint(rulesPath, fp);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			throw new CliError(copy.ignore.noRulesFile(displayPath(deps.context.cwd, rulesPath)), {
				exitCode: EXIT.config,
			});
		}
		throw err;
	}
	const shown = displayPath(deps.context.cwd, rulesPath) || rulesPath;
	if (status === "already") {
		ui.line(copy.ignore.already(fp));
	} else {
		ui.line(copy.ignore.added(fp, shown));
		ui.line(ui.colors.dim(copy.ignore.reminder));
	}
	return EXIT.ok;
}
