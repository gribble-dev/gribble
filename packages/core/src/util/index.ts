import { createHash } from "node:crypto";
import { minimatch } from "minimatch";

/** Hex-encoded SHA-256 of a string or buffer. */
export function sha256(input: string | Uint8Array): string {
	return createHash("sha256").update(input).digest("hex");
}

/** True for plain objects (not arrays, not null, not class instances). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/**
 * Deep merge `patch` over `base`. Plain objects are merged recursively, arrays and
 * scalars are replaced, `undefined` values in the patch are ignored. Neither input is mutated.
 */
export function deepMerge<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
	const out: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) continue;
		const existing = out[key];
		if (isPlainObject(existing) && isPlainObject(value)) {
			out[key] = deepMerge(existing, value);
		} else if (isPlainObject(value)) {
			out[key] = deepMerge({}, value);
		} else {
			out[key] = value;
		}
	}
	return out as T;
}

/**
 * Normalize a URL for comparison: lowercase scheme and host, drop the fragment,
 * drop default ports, drop a trailing slash on non-root paths. The query string is kept.
 * Returns the input unchanged when it is not an absolute URL.
 */
export function normalizeUrl(input: string): string {
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		return input;
	}
	url.hash = "";
	url.hostname = url.hostname.toLowerCase();
	if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
		url.pathname = url.pathname.replace(/\/+$/, "");
	}
	return url.toString();
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/**
 * Match a hostname (or absolute URL) against origin patterns such as `localhost`,
 * `*.vercel.app` or `staging.example.com`. Matching is case-insensitive; `localhost`
 * also matches the loopback addresses `127.0.0.1` and `::1`.
 */
export function matchOrigin(hostname: string, patterns: readonly string[]): boolean {
	const host = extractHostname(hostname);
	if (!host) return false;
	for (const raw of patterns) {
		const pattern = extractHostname(raw);
		if (!pattern) continue;
		if (pattern === host) return true;
		if (pattern === "localhost" && LOOPBACK.has(host)) return true;
		if (minimatch(host, pattern, { nocase: true, dot: true })) return true;
	}
	return false;
}

function extractHostname(value: string): string {
	const trimmed = value.trim().toLowerCase();
	if (/^[a-z][a-z0-9+.-]*:\/\//.test(trimmed)) {
		try {
			return new URL(trimmed).hostname.replace(/^\[(.*)\]$/, "$1");
		} catch {
			return "";
		}
	}
	// Strip a port when the value looks like host:port (but not an IPv6 literal).
	if (!trimmed.includes("*") && /^[^:]+:\d+$/.test(trimmed)) {
		return trimmed.replace(/:\d+$/, "");
	}
	return trimmed.replace(/^\[(.*)\]$/, "$1");
}

/**
 * Match a route path against one or more glob patterns (`/admin/**`, `/blog/*`).
 * `/admin/**` also matches `/admin` itself, which plain minimatch does not.
 */
export function globMatch(route: string, patterns: string | readonly string[]): boolean {
	const list = typeof patterns === "string" ? [patterns] : patterns;
	for (const pattern of list) {
		if (minimatch(route, pattern, { dot: true })) return true;
		if (pattern.endsWith("/**")) {
			const prefix = pattern.slice(0, -3) || "/";
			if (minimatch(route, prefix, { dot: true })) return true;
		}
	}
	return false;
}

/** Pluralize a noun with a count, e.g. `plural(1, "hole")` -> "1 hole". */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : pluralForm}`;
}
