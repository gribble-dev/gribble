import type { Finding, LoadedReport, Report } from "../src/types.js";

let counter = 0;

export function finding(overrides: Partial<Finding> = {}): Finding {
	counter += 1;
	const rule = overrides.rule ?? "links/broken";
	return {
		fingerprint: `fp${String(counter).padStart(4, "0")}`,
		rule,
		severity: "error",
		source: "deterministic",
		status: "new",
		title: `Finding ${counter}`,
		message: "Something is off.",
		route: "/",
		docsUrl: `https://gribble.dev/rules/${rule}`,
		...overrides,
	};
}

export function report(overrides: Partial<Report> = {}): Report {
	const findings = overrides.findings ?? [];
	const fresh = findings.filter((f) => f.status === "new");
	const counts = { critical: 0, error: 0, warn: 0, info: 0 };
	for (const f of fresh) counts[f.severity] += 1;
	const gate = fresh.some(
		(f) => f.source === "deterministic" && (f.severity === "critical" || f.severity === "error"),
	)
		? "fail"
		: "pass";
	return {
		version: 1,
		gribbleVersion: "0.1.0",
		generatedAt: "2026-01-01T00:00:00.000Z",
		mode: "all",
		target: { name: "", url: "http://localhost:3000" },
		budget: { steps: 10, maxSteps: 200, tokens: 1000, maxTokens: 2_000_000, costUsd: 0.01 },
		baseline: { present: true, bootstrap: false },
		summary: {
			counts,
			newCount: fresh.length,
			existingCount: findings.filter((f) => f.status === "existing").length,
			fixedCount: findings.filter((f) => f.status === "fixed").length,
			gate,
			headline:
				fresh.length === 0
					? "The gribbles went hungry. Ship it."
					: `The gribbles found ${fresh.length} holes in your hull.`,
		},
		findings,
		routes: [{ route: "/", url: "http://localhost:3000/" }],
		flows: [],
		durationMs: 1234,
		...overrides,
	};
}

export function loaded(r: Report, targetDir = "/repo"): LoadedReport {
	return {
		report: r,
		path: `${targetDir}/.gribble/runs/latest.json`,
		gribbleDir: `${targetDir}/.gribble`,
		targetDir,
	};
}
