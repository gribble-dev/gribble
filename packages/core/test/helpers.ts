import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Finding, Report } from "../src/index.js";
import { computeFingerprint, GRIBBLE_CORE_VERSION, summarizeReport } from "../src/index.js";

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "gribble-test-"));
	try {
		return await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
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
		gribbleVersion: GRIBBLE_CORE_VERSION,
		generatedAt: "2026-09-11T10:20:30.123Z",
		mode: "all",
		target: { name: "", url: "http://localhost:3000" },
		budget: { steps: 12, maxSteps: 200, tokens: 3456, maxTokens: 2000000, costUsd: 0.12 },
		baseline: { present: false, bootstrap: false },
		summary: summarizeReport(findings),
		findings,
		routes: [],
		flows: [],
		durationMs: 4200,
		...partial,
	};
}
