/**
 * Shim around `@gribble/core`'s report formatters. Core is built concurrently
 * and may not export every formatter yet, so each symbol is looked up at
 * runtime and replaced by a local fallback when missing or throwing.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as actionsCore from "@actions/core";
import {
	fallbackJUnit,
	fallbackMarkdownSummary,
	fallbackSarif,
	type MarkdownSummaryOptions,
} from "./fallback-formatters.js";
import type { Report } from "./types.js";

export interface Formatters {
	toMarkdownSummary(report: Report, opts?: MarkdownSummaryOptions): string;
	toSarif(report: Report): object;
	toJUnit(report: Report): string;
	/** Which implementation backs each formatter; for logs and tests. */
	sources: Record<"toMarkdownSummary" | "toSarif" | "toJUnit", "core" | "fallback">;
}

// biome-ignore lint/suspicious/noExplicitAny: generic function shim over untyped core exports
type AnyFn = (...args: any[]) => any;

/**
 * `@gribble/core` is not bundled into the action (it pulls in Playwright and Lighthouse).
 * It is resolved from the audited repository, where `gribble` is installed as a devDependency,
 * walking up from the working directory so monorepo roots work too.
 */
async function loadCoreModule(searchDir: string): Promise<Record<string, unknown> | undefined> {
	try {
		const require = createRequire(path.join(searchDir, "package.json"));
		const entry = require.resolve("@gribble/core");
		const mod = (await import(pathToFileURL(entry).href)) as Record<string, unknown>;
		return mod;
	} catch (error) {
		actionsCore.debug(
			`@gribble/core is not available: ${error instanceof Error ? error.message : String(error)}`,
		);
		return undefined;
	}
}

function pick<T extends AnyFn>(mod: Record<string, unknown> | undefined, name: string): T | undefined {
	const candidate = mod?.[name];
	return typeof candidate === "function" ? (candidate as T) : undefined;
}

function guarded<T extends AnyFn>(
	name: string,
	primary: T | undefined,
	fallback: T,
): { fn: T; source: "core" | "fallback" } {
	if (!primary) return { fn: fallback, source: "fallback" };
	const fn = ((...args: Parameters<T>): ReturnType<T> => {
		try {
			const result = primary(...args);
			if (result === undefined || result === null) return fallback(...args);
			return result;
		} catch (error) {
			actionsCore.warning(
				`@gribble/core.${name} threw (${error instanceof Error ? error.message : String(error)}); using the built-in fallback.`,
			);
			return fallback(...args);
		}
	}) as T;
	return { fn, source: "core" };
}

let cached: Promise<Formatters> | undefined;

export function loadFormatters(searchDir: string = process.cwd()): Promise<Formatters> {
	if (!cached) cached = buildFormatters(searchDir);
	return cached;
}

async function buildFormatters(searchDir: string): Promise<Formatters> {
	const mod = await loadCoreModule(searchDir);
	const md = guarded(
		"toMarkdownSummary",
		pick<Formatters["toMarkdownSummary"]>(mod, "toMarkdownSummary"),
		fallbackMarkdownSummary,
	);
	const sarif = guarded("toSarif", pick<Formatters["toSarif"]>(mod, "toSarif"), fallbackSarif);
	const junit = guarded("toJUnit", pick<Formatters["toJUnit"]>(mod, "toJUnit"), fallbackJUnit);
	const sources = { toMarkdownSummary: md.source, toSarif: sarif.source, toJUnit: junit.source };
	const missing = Object.entries(sources)
		.filter(([, s]) => s === "fallback")
		.map(([n]) => n);
	if (missing.length > 0) {
		actionsCore.debug(`Using built-in fallbacks for: ${missing.join(", ")}`);
	}
	return { toMarkdownSummary: md.fn, toSarif: sarif.fn, toJUnit: junit.fn, sources };
}

/** Test hook: reset the cached formatter set. */
export function resetFormattersForTests(): void {
	cached = undefined;
}
