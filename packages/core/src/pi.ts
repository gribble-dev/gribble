/**
 * The pi runtime is an optional peer dependency. `gate` is deterministic and never constructs a
 * model, so a gate-only install has no business pulling in three provider SDKs and a cloud
 * credential chain. Every *value* use of `@earendil-works/pi-*` therefore goes through the loader
 * below, which resolves the package on first use; `import type` stays static and erases at build.
 *
 * Keep it that way: a top-level value import anywhere in the module graph puts the whole runtime
 * back on the gate-only install, silently.
 */

/**
 * Exact version of the pi packages this build expects, injected from the pnpm catalog at build
 * time (see `tsdown.config.ts`) so the peer ranges and the install command below cannot drift
 * apart. Unbundled runs — vitest, the `tsx` scripts — have no define and fall back to the range.
 */
declare const __GRIBBLE_PI_VERSION__: string | undefined;

export const PI_RUNTIME_VERSION: string =
	typeof __GRIBBLE_PI_VERSION__ === "string" ? __GRIBBLE_PI_VERSION__ : "latest";

/** The packages `--mode review` needs on disk, in the order the install command lists them. */
export const REVIEW_RUNTIME_PACKAGES = ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"] as const;

/** `npm install @earendil-works/pi-ai@X @earendil-works/pi-coding-agent@X`. */
export const REVIEW_RUNTIME_INSTALL_COMMAND = `npm install ${REVIEW_RUNTIME_PACKAGES.map(
	(name) => `${name}@${PI_RUNTIME_VERSION}`,
).join(" ")}`;

/**
 * The review runtime is not installed. Matched by `name` in the CLI, like the other core error
 * classes, so a CLI bundled against one copy of core still recognizes it.
 */
export class ReviewRuntimeMissingError extends Error {
	readonly packages: readonly string[] = REVIEW_RUNTIME_PACKAGES;
	readonly command = REVIEW_RUNTIME_INSTALL_COMMAND;

	constructor(cause?: unknown) {
		super(
			`The AI review runtime is not installed. Run \`${REVIEW_RUNTIME_INSTALL_COMMAND}\` to add it, or use \`--mode gate\`, which needs no model.`,
			cause === undefined ? undefined : { cause },
		);
		this.name = "ReviewRuntimeMissingError";
	}
}

/** A resolution failure naming one of the pi packages, rather than a fault inside pi itself. */
function isMissingPiPackage(err: unknown): boolean {
	const e = err as { code?: unknown; message?: unknown } | null;
	if (!e || (e.code !== "ERR_MODULE_NOT_FOUND" && e.code !== "MODULE_NOT_FOUND")) return false;
	return typeof e.message === "string" && e.message.includes("@earendil-works/");
}

let codingAgent: Promise<typeof import("@earendil-works/pi-coding-agent")> | undefined;

/**
 * `@earendil-works/pi-coding-agent`, loaded on first use. Throws {@link ReviewRuntimeMissingError}
 * when the optional peer is absent; anything else pi throws while loading propagates untouched.
 */
export function loadPiCodingAgent(): Promise<typeof import("@earendil-works/pi-coding-agent")> {
	codingAgent ??= import("@earendil-works/pi-coding-agent").catch((err: unknown) => {
		codingAgent = undefined;
		if (isMissingPiPackage(err)) throw new ReviewRuntimeMissingError(err);
		throw err;
	});
	return codingAgent;
}
