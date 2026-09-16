/** Exit codes, per docs/cli.md. */
export const EXIT = {
	ok: 0,
	gateFailed: 1,
	config: 2,
	crash: 3,
	cancelled: 130,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** An error the CLI already knows how to present: message, optional hint, exit code. */
export class CliError extends Error {
	readonly exitCode: number;
	readonly hint?: string;

	constructor(message: string, opts: { exitCode?: number; hint?: string; cause?: unknown } = {}) {
		super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
		this.name = "CliError";
		this.exitCode = opts.exitCode ?? EXIT.config;
		this.hint = opts.hint;
	}
}

/** The user pressed Ctrl+C in a prompt. */
export class CancelledError extends CliError {
	constructor(message = "Cancelled.") {
		super(message, { exitCode: EXIT.cancelled });
		this.name = "CancelledError";
	}
}

function errorName(err: unknown): string | undefined {
	if (err && typeof err === "object" && "name" in err && typeof err.name === "string") return err.name;
	return undefined;
}

/**
 * Core signals configuration and auth problems with named error classes. They are matched by
 * name rather than `instanceof` so a CLI bundled against one copy of core still recognizes errors
 * thrown by another copy resolved from the audited repository.
 */
export function isConfigError(err: unknown): boolean {
	return errorName(err) === "ConfigError";
}

export function isAuthError(err: unknown): boolean {
	const name = errorName(err);
	return name === "ModelAuthError" || name === "NoModelError";
}

export function isNoModelError(err: unknown): boolean {
	return errorName(err) === "NoModelError";
}

/**
 * `--mode review`, `--mode all` or `gribble login` was reached without the optional pi peer
 * dependencies on disk. Core throws it from the lazy import; the CLI turns it into the install
 * command plus the reminder that gate needs none of it.
 */
export function isReviewRuntimeMissingError(err: unknown): boolean {
	return errorName(err) === "ReviewRuntimeMissingError";
}

export function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}
