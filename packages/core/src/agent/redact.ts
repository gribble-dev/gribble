import type { GribbleConfig } from "../config/types.js";

export const REDACTED = "***";

/**
 * Replace every occurrence of a known secret value in a string. Values shorter than 4 characters
 * are skipped: they would redact half the page.
 */
export function redactString(text: string, secrets: readonly string[]): string {
	let out = text;
	for (const secret of secrets) {
		if (secret.length < 4) continue;
		if (!out.includes(secret)) continue;
		out = out.split(secret).join(REDACTED);
	}
	return out;
}

/**
 * Deep-redact strings inside any JSON-like value. Objects and arrays are mutated in place (pi
 * requires in-place mutation of `event.input`); the (possibly new) value is returned so callers can
 * also use it functionally on primitives.
 */
export function redactValue<T>(value: T, secrets: readonly string[]): T {
	if (secrets.length === 0) return value;
	if (typeof value === "string") return redactString(value, secrets) as T;
	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) value[i] = redactValue(value[i], secrets);
		return value;
	}
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		for (const key of Object.keys(record)) record[key] = redactValue(record[key], secrets);
		return value;
	}
	return value;
}

/** Values of every environment variable referenced by `auth.profiles.*.env`, for redaction. */
export function collectSecretValues(config: GribbleConfig, env: NodeJS.ProcessEnv): string[] {
	const out = new Set<string>();
	for (const profile of Object.values(config.auth?.profiles ?? {})) {
		const refs: Record<string, string> = "env" in profile && profile.env ? profile.env : {};
		for (const varName of Object.values(refs)) {
			const value = env[varName];
			if (value) out.add(value);
		}
	}
	return [...out];
}
