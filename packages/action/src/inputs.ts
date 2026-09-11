import type { AuditMode } from "./types.js";

export type FailOn = "critical" | "error" | "warn" | "none";

export interface ActionInputs {
	mode: AuditMode;
	/** Relative to the workspace, "" means the workspace root. */
	workingDirectory: string;
	target?: string;
	all: boolean;
	environment?: string;
	updateBaseline: boolean;
	comment: boolean;
	/** Cap for new per-finding PR comments. */
	maxComments: number;
	failOn: FailOn;
	githubToken: string;
	reportArtifact: boolean;
}

export const DEFAULT_MAX_COMMENTS = 5;

const MODES: readonly AuditMode[] = ["gate", "review", "all"];
const FAIL_ON: readonly FailOn[] = ["critical", "error", "warn", "none"];

export class InputError extends Error {
	constructor(
		readonly input: string,
		message: string,
	) {
		super(`Input \`${input}\`: ${message}`);
		this.name = "InputError";
	}
}

/** Same truthiness rules as `@actions/core.getBooleanInput` (YAML 1.2 core schema). */
export function parseBoolean(name: string, raw: string, fallback: boolean): boolean {
	const value = raw.trim();
	if (value === "") return fallback;
	if (["true", "True", "TRUE"].includes(value)) return true;
	if (["false", "False", "FALSE"].includes(value)) return false;
	throw new InputError(name, `expected true or false, got "${raw}"`);
}

function parseEnum<T extends string>(name: string, raw: string, allowed: readonly T[], fallback: T): T {
	const value = raw.trim().toLowerCase();
	if (value === "") return fallback;
	if ((allowed as readonly string[]).includes(value)) return value as T;
	throw new InputError(name, `expected one of ${allowed.join(", ")}, got "${raw}"`);
}

function parseOptionalString(raw: string): string | undefined {
	const value = raw.trim();
	return value === "" ? undefined : value;
}

/**
 * Parse action inputs from a getter (`@actions/core.getInput` in production,
 * a plain map in tests). Validation errors throw `InputError`.
 */
export function parseInputs(get: (name: string) => string): ActionInputs {
	const maxRaw = get("max-comments").trim();
	let maxComments = DEFAULT_MAX_COMMENTS;
	if (maxRaw !== "") {
		const n = Number(maxRaw);
		if (!Number.isInteger(n) || n < 0) {
			throw new InputError("max-comments", `expected a non-negative integer, got "${maxRaw}"`);
		}
		maxComments = n;
	}

	const workingDirectory = get("working-directory")
		.trim()
		.replace(/^\.\/+/, "")
		.replace(/[\\/]+$/, "");

	const inputs: ActionInputs = {
		mode: parseEnum("mode", get("mode"), MODES, "all"),
		workingDirectory: workingDirectory === "." ? "" : workingDirectory,
		all: parseBoolean("all", get("all"), false),
		updateBaseline: parseBoolean("update-baseline", get("update-baseline"), false),
		comment: parseBoolean("comment", get("comment"), true),
		maxComments,
		failOn: parseEnum("fail-on", get("fail-on"), FAIL_ON, "error"),
		githubToken: get("github-token").trim(),
		reportArtifact: parseBoolean("report-artifact", get("report-artifact"), true),
	};
	const target = parseOptionalString(get("target"));
	if (target !== undefined) inputs.target = target;
	const environment = parseOptionalString(get("environment"));
	if (environment !== undefined) inputs.environment = environment;

	if (inputs.all && inputs.target) {
		throw new InputError("all", "cannot be combined with `target`");
	}
	return inputs;
}
