/**
 * Auth profiles (brief §16): cookie, header, command and flow. Secrets are only ever env var names
 * in gribble.yaml; the values come from `env` at runtime and are listed by `secretValues` for redaction.
 */
import { exec } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { BrowserContextOptions } from "playwright";
import type { AuthProfile, GribbleConfig } from "../config/types.js";

const execAsync = promisify(exec);

export const AUTH_CACHE_DIR = join("cache", "auth");
export const AUTH_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const LOGIN_URL_PATTERN = /\/(login|signin|sign-in|auth)(\/|\?|#|$)/i;

export type StorageState = NonNullable<Exclude<BrowserContextOptions["storageState"], string>>;

export interface AuthCacheEntry {
	savedAt: string;
	storageState: StorageState;
}

/** Every secret value referenced by `auth.profiles.*.env`, for redaction in logs and sessions. */
export function secretValues(config: GribbleConfig, env: NodeJS.ProcessEnv): string[] {
	const out = new Set<string>();
	for (const profile of Object.values(config.auth?.profiles ?? {})) {
		const names =
			profile.type === "flow"
				? Object.values(profile.env ?? {})
				: "env" in profile
					? [profile.env.value]
					: [];
		for (const name of names) {
			const value = env[name];
			if (value && value.length >= 3) out.add(value);
		}
	}
	return [...out];
}

export function authCachePath(gribbleDir: string, profile: string): string {
	return join(gribbleDir, AUTH_CACHE_DIR, `${profile.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
}

export async function readAuthCache(
	gribbleDir: string,
	profile: string,
): Promise<AuthCacheEntry | undefined> {
	try {
		const parsed = JSON.parse(await readFile(authCachePath(gribbleDir, profile), "utf8")) as AuthCacheEntry;
		if (!parsed?.savedAt || !parsed.storageState) return undefined;
		if (Date.now() - Date.parse(parsed.savedAt) > AUTH_CACHE_MAX_AGE_MS) return undefined;
		return parsed;
	} catch {
		return undefined;
	}
}

export async function writeAuthCache(
	gribbleDir: string,
	profile: string,
	state: StorageState,
): Promise<void> {
	const file = authCachePath(gribbleDir, profile);
	await mkdir(join(gribbleDir, AUTH_CACHE_DIR), { recursive: true });
	const entry: AuthCacheEntry = { savedAt: new Date().toISOString(), storageState: state };
	await writeFile(file, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
}

/** True when a URL looks like a login page (the probe landed on it after following redirects). */
export function looksLikeLoginUrl(url: string): boolean {
	try {
		return LOGIN_URL_PATTERN.test(new URL(url).pathname);
	} catch {
		return LOGIN_URL_PATTERN.test(url);
	}
}

export class AuthError extends Error {
	constructor(
		message: string,
		readonly profile: string,
	) {
		super(message);
		this.name = "AuthError";
	}
}

function requireEnv(env: NodeJS.ProcessEnv, name: string, profile: string): string {
	const value = env[name];
	if (!value) {
		throw new AuthError(
			`auth profile "${profile}" needs the environment variable ${name}, which is not set.`,
			profile,
		);
	}
	return value;
}

/** Context options derived from a static profile (cookie or header). */
export function staticProfileContextOptions(
	name: string,
	profile: AuthProfile,
	env: NodeJS.ProcessEnv,
	targetUrl: string,
): BrowserContextOptions {
	if (profile.type === "cookie") {
		const value = requireEnv(env, profile.env.value, name);
		const host = profile.domain ?? new URL(targetUrl).hostname;
		return {
			storageState: {
				cookies: [
					{
						name: profile.name,
						value,
						domain: host,
						path: "/",
						expires: -1,
						httpOnly: false,
						secure: targetUrl.startsWith("https://"),
						sameSite: "Lax",
					},
				],
				origins: [],
			},
		};
	}
	if (profile.type === "header") {
		const value = requireEnv(env, profile.env.value, name);
		return { extraHTTPHeaders: { [profile.name]: value } };
	}
	return {};
}

/** Run a `command` profile and parse its stdout as a Playwright storageState. */
export async function runCommandProfile(
	name: string,
	command: string,
	opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<StorageState> {
	let stdout: string;
	try {
		({ stdout } = await execAsync(command, {
			cwd: opts.cwd,
			env: opts.env,
			timeout: opts.timeoutMs ?? 120_000,
			maxBuffer: 16 * 1024 * 1024,
		}));
	} catch (err) {
		throw new AuthError(`auth profile "${name}": command failed: ${(err as Error).message}`, name);
	}
	const start = stdout.indexOf("{");
	if (start === -1) {
		throw new AuthError(`auth profile "${name}": command printed no JSON storageState.`, name);
	}
	try {
		const parsed = JSON.parse(stdout.slice(start)) as StorageState;
		return { cookies: parsed.cookies ?? [], origins: parsed.origins ?? [] };
	} catch (err) {
		throw new AuthError(
			`auth profile "${name}": stdout is not a storageState: ${(err as Error).message}`,
			name,
		);
	}
}
