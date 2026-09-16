/**
 * Helpers shared by the tool packs: result builders, check-context construction and the
 * design-token bridge for snapshots.
 */
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type TUnsafe, Type } from "typebox";
import type { AuditPage, SnapshotTokens } from "../../browser/types.js";
import type { CheckContext } from "../../checks/types.js";
import { readDesignTokens } from "../../repo/index.js";
import type { Finding } from "../../report/schema.js";
import type { AgentState } from "../state.js";

/**
 * A string-enum schema: `{ type: "string", enum: [...] }`, the shape Google's API and other
 * providers accept where `anyOf`/`const` is not understood. pi exports the same four lines as
 * `StringEnum`, but the tool packs are reachable from the core entry point, so importing it would
 * make the optional review runtime a hard requirement of `--mode gate`. See `../../pi.ts`.
 */
export function StringEnum<T extends readonly string[]>(
	values: T,
	options: { description?: string; default?: T[number] } = {},
): TUnsafe<T[number]> {
	return Type.Unsafe<T[number]>({
		type: "string",
		enum: [...values],
		...(options.description ? { description: options.description } : {}),
		...(options.default ? { default: options.default } : {}),
	});
}

export function textResult<T>(
	text: string,
	details: T,
	extra: { terminate?: boolean } = {},
): AgentToolResult<T> {
	return { content: [{ type: "text", text }], details, ...extra };
}

/** One line per finding, for tool results that wrap deterministic checks. */
export function formatFindings(findings: Finding[], added: number): string {
	if (findings.length === 0) return "No findings.";
	const lines = findings
		.slice(0, 50)
		.map((f) => `- ${f.severity} ${f.rule} ${f.route}: ${f.title}${f.subject ? ` (${f.subject})` : ""}`);
	if (findings.length > 50) lines.push(`- ... ${findings.length - 50} more`);
	const note = added < findings.length ? ` ${findings.length - added} already known.` : "";
	return `${findings.length} finding(s), ${added} new.${note}\n${lines.join("\n")}`;
}

/** Record deterministic findings from a wrapped check into the session state. */
export function absorbFindings(state: AgentState, findings: Finding[]): number {
	let added = 0;
	for (const finding of findings) if (state.addFinding(finding)) added++;
	return added;
}

let tokensCache: { targetDir: string; promise: Promise<SnapshotTokens | undefined> } | undefined;

/** Design tokens for the snapshot style sampler, only when a `ui/*-from-tokens` rule is on. Cached per target. */
export function snapshotTokensFor(state: AgentState): Promise<SnapshotTokens | undefined> {
	const rules = state.project.rules;
	const wantColors = rules.get("ui/colors-from-tokens").severity !== "off";
	const wantFonts = rules.get("ui/font-sizes-from-tokens").severity !== "off";
	const wantSpacing = rules.get("ui/spacing-from-tokens").severity !== "off";
	if (!wantColors && !wantFonts && !wantSpacing) return Promise.resolve(undefined);
	const targetDir = state.project.targetDir;
	if (!tokensCache || tokensCache.targetDir !== targetDir) {
		tokensCache = {
			targetDir,
			promise: readDesignTokens(targetDir).then(
				(tokens) => ({
					colors: wantColors ? [...tokens.colors] : undefined,
					fontSizes: wantFonts ? [...tokens.fontSizes] : undefined,
					spacing: wantSpacing ? [...tokens.spacing] : undefined,
				}),
				(err) => {
					state.log("warn", `Design tokens could not be read: ${(err as Error).message}`);
					return undefined;
				},
			),
		};
	}
	return tokensCache.promise;
}

/** Minimum font size in px from `ui/min-font-size` options, when the rule is on. */
export function minFontPx(state: AgentState): number | undefined {
	const { severity, options } = state.project.rules.get("ui/min-font-size");
	if (severity === "off") return undefined;
	return typeof options.px === "number" ? options.px : undefined;
}

/** The `CheckContext` the deterministic checkers expect, for the current page. */
export function checkContextFor(
	state: AgentState,
	page: AuditPage,
	opts: { signal?: AbortSignal } = {},
): CheckContext {
	const url = page.url();
	const route = state.trackUrl(url);
	return {
		project: state.project,
		page,
		route,
		url,
		viewport: page.viewport,
		targetName: state.targetName,
		runDir: state.runDir,
		signal: opts.signal ?? state.signal,
		onEvent: state.onEvent,
	};
}

/** `ref=e12` -> `e12`; anything else -> undefined. */
export function refOf(target: string): string | undefined {
	const match = /^ref=(e\d+)$/i.exec(target.trim());
	return match ? match[1] : undefined;
}
