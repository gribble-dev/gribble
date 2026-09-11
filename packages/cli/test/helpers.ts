import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import type { Finding, ModelResolution, ProjectContext, Report } from "@gribble/core";
import { computeFingerprint, summarizeReport } from "@gribble/core";
import { CliError } from "../src/errors.js";
import type { Prompter, PromptOption, PromptSpinner } from "../src/prompts.js";
import type { ProviderInfo, RuntimeLike } from "../src/providers.js";
import type { RunContext } from "../src/ui.js";

/** A writable that keeps what was written. */
export class MemoryStream extends Writable {
	chunks: string[] = [];
	override _write(chunk: Buffer | string, _enc: BufferEncoding, cb: () => void): void {
		this.chunks.push(chunk.toString());
		cb();
	}
	get text(): string {
		return this.chunks.join("");
	}
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "gribble-cli-"));
	try {
		return await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

export interface TestIo {
	stdout: MemoryStream;
	stderr: MemoryStream;
	context: RunContext;
}

/** Streams plus a non-TTY context with a clean environment (no CI, no NO_COLOR). */
export function testIo(opts: { cwd?: string; isTTY?: boolean; env?: NodeJS.ProcessEnv } = {}): TestIo {
	const stdout = new MemoryStream();
	const stderr = new MemoryStream();
	return {
		stdout,
		stderr,
		context: {
			cwd: opts.cwd ?? process.cwd(),
			env: { PATH: process.env.PATH, HOME: process.env.HOME, ...opts.env },
			stdout,
			stderr,
			isTTY: opts.isTTY ?? false,
		},
	};
}

export function finding(partial: Partial<Finding> & { rule: string; route: string; title: string }): Finding {
	const base: Finding = {
		fingerprint: "",
		severity: "warn",
		source: "deterministic",
		status: "new",
		message: `${partial.title} (details)`,
		docsUrl: `https://gribble.dev/rules/${partial.rule}`,
		...partial,
	} as Finding;
	if (!base.fingerprint) {
		base.fingerprint = computeFingerprint({
			rule: base.rule,
			route: base.route,
			location: base.location,
			subject: base.subject,
		});
	}
	return base;
}

export function report(findings: Finding[], partial: Partial<Report> = {}): Report {
	return {
		version: 1,
		gribbleVersion: "0.1.0-test",
		generatedAt: "2026-09-12T10:20:30.123Z",
		mode: "gate",
		target: { name: "", url: "http://localhost:3000" },
		budget: { steps: 12, maxSteps: 200, tokens: 318_000, maxTokens: 2_000_000, costUsd: 0.42 },
		baseline: { present: true, bootstrap: false },
		summary: summarizeReport(findings),
		findings,
		routes: [{ route: "/", url: "http://localhost:3000/" }],
		flows: [],
		durationMs: 4200,
		...partial,
	};
}

export function project(overrides: Partial<ProjectContext> = {}): ProjectContext {
	const targetDir = overrides.targetDir ?? "/repo";
	return {
		repoRoot: "/repo",
		targetDir,
		gribbleDir: join(targetDir, ".gribble"),
		targetName: "",
		config: {
			target: { url: "http://localhost:3000", routes: "auto", readyTimeoutMs: 120_000 },
			review: { max_comments: 5, min_confidence: 0.7, vision: false, explore: true },
			budget: { max_steps: 200, max_tokens: 2_000_000 },
			allowed_origins: ["localhost"],
			baseline: { screenshots: "commit", update: "commit" },
			viewports: { desktop: { width: 1366, height: 768 } },
			output: { dir: ".gribble/runs", keep: 10 },
			reusePiAuth: false,
		},
		rules: { get: () => ({ severity: "warn", options: {} }), ignore: new Set(), entries: () => [] } as never,
		guidelines: "",
		flows: [],
		cascade: [],
		...overrides,
	};
}

export interface FakeModel {
	provider: string;
	id: string;
	name?: string;
}

/** Minimal `ModelRuntime` stand-in: providers with auth state and an available model list. */
export function fakeRuntime(opts: {
	models?: FakeModel[];
	providers?: Array<Partial<ProviderInfo> & { id: string }>;
	stored?: string[];
}): RuntimeLike & { loggedOut: string[] } {
	const models = opts.models ?? [];
	const providers = opts.providers ?? [];
	const stored = new Set(opts.stored ?? []);
	const loggedOut: string[] = [];
	return {
		loggedOut,
		getProviders: () =>
			providers.map((p) => ({
				id: p.id,
				name: p.name ?? p.id,
				auth: {
					apiKey:
						p.apiKey === false
							? undefined
							: { name: `${p.id} key`, login: async () => ({ type: "api_key" }) },
					oauth: p.oauth ? { name: "oauth", loginLabel: p.oauthLabel } : undefined,
				},
			})) as never,
		getAvailable: async () => models as never,
		checkAuth: async (id) => {
			const p = providers.find((x) => x.id === id);
			return p?.configured ? { type: "api_key", source: p.source ?? "ENV" } : undefined;
		},
		getModel: (provider, id) => models.find((m) => m.provider === provider && m.id === id) as never,
		listCredentials: async () => [...stored].map((providerId) => ({ providerId, type: "api_key" as const })),
		logout: async (id) => {
			stored.delete(id);
			loggedOut.push(id);
		},
	};
}

export function resolution(provider = "prov", id = "model-x"): ModelResolution {
	return { model: { provider, id, name: id } as never };
}

/** A recording spinner for renderer tests. */
export function fakeSpinner(log: string[]): PromptSpinner {
	return {
		start: (m) => log.push(`[spinner start] ${m ?? ""}`),
		message: (m) => log.push(`[spinner message] ${m ?? ""}`),
		stop: (m) => log.push(`[spinner stop] ${m ?? ""}`),
		error: (m) => log.push(`[spinner error] ${m ?? ""}`),
		clear: () => log.push("[spinner clear]"),
	};
}

export type ScriptedAnswer =
	| { text: string }
	| { secret: string }
	| { confirm: boolean }
	| { select: unknown }
	| { multiselect: unknown[] };

/**
 * A prompter that answers from a script, in order, and logs every message. Throws a
 * `CliError` when the script runs out, so an unexpected question fails the test loudly.
 */
export function scriptedPrompter(
	answers: ScriptedAnswer[],
	log: string[] = [],
): Prompter & { log: string[] } {
	const queue = [...answers];
	function next(kind: string, message: string): unknown {
		const answer = queue.shift();
		if (!answer || !(kind in answer)) {
			throw new CliError(`unexpected ${kind} prompt: ${message}`, { exitCode: 99 });
		}
		log.push(`[${kind}] ${message}`);
		return (answer as Record<string, unknown>)[kind];
	}
	return {
		log,
		intro: (m) => log.push(`[intro] ${m}`),
		outro: (m) => log.push(`[outro] ${m}`),
		note: (m, t) => log.push(`[note] ${t ? `${t}: ` : ""}${m}`),
		info: (m) => log.push(`[info] ${m}`),
		success: (m) => log.push(`[success] ${m}`),
		warn: (m) => log.push(`[warn] ${m}`),
		error: (m) => log.push(`[error] ${m}`),
		step: (m) => log.push(`[step] ${m}`),
		text: async (o) => next("text", o.message) as string,
		secret: async (o) => next("secret", o.message) as string,
		confirm: async (o) => next("confirm", o.message) as boolean,
		select: async <V>(o: { message: string; options: PromptOption<V>[] }) => {
			const wanted = next("select", o.message);
			const match = o.options.find((opt) => opt.value === wanted || opt.label === wanted);
			if (!match) throw new CliError(`no option "${String(wanted)}" for: ${o.message}`, { exitCode: 99 });
			return match.value;
		},
		multiselect: async <V>(o: { message: string; options: PromptOption<V>[] }) => {
			const wanted = next("multiselect", o.message) as unknown[];
			return o.options
				.filter((opt) => wanted.includes(opt.value) || wanted.includes(opt.label))
				.map((opt) => opt.value);
		},
		spinner: () => fakeSpinner(log),
	};
}
