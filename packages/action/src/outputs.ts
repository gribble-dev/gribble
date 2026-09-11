import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as core from "@actions/core";
import type { Formatters } from "./core.js";
import type { LoadedReport } from "./types.js";

export interface WrittenOutputs {
	sarifPath: string;
	junitPath: string;
	reportPath: string;
}

/** Merge several SARIF documents by concatenating their runs. */
export function mergeSarif(docs: object[]): object {
	const first = docs[0] as { $schema?: string; version?: string; runs?: unknown[] } | undefined;
	return {
		$schema: first?.$schema ?? "https://json.schemastore.org/sarif-2.1.0.json",
		version: first?.version ?? "2.1.0",
		runs: docs.flatMap((d) => (d as { runs?: unknown[] }).runs ?? []),
	};
}

/** Merge several JUnit documents into one `<testsuites>` by lifting their `<testsuite>` elements. */
export function mergeJUnit(docs: string[]): string {
	if (docs.length === 1) return docs[0] ?? "";
	const suites: string[] = [];
	for (const doc of docs) {
		const matches = doc.match(/<testsuite\b[\s\S]*?<\/testsuite>|<testsuite\b[^>]*\/>/g);
		if (matches) suites.push(...matches.map((s) => s.replace(/^/gm, "  ")));
	}
	const attr = (name: string) =>
		docs.reduce(
			(sum, d) => sum + Number(new RegExp(`<testsuites\\b[^>]*\\b${name}="(\\d+)"`).exec(d)?.[1] ?? 0),
			0,
		);
	return [
		`<?xml version="1.0" encoding="UTF-8"?>`,
		`<testsuites name="gribble" tests="${attr("tests")}" failures="${attr("failures")}" errors="${attr("errors")}" skipped="${attr("skipped")}">`,
		...suites,
		"</testsuites>",
		"",
	].join("\n");
}

/**
 * Write `gribble.sarif` and `gribble-junit.xml` next to the report
 * (`.gribble/runs/`). With several targets the combined files go to RUNNER_TEMP.
 */
export async function writeOutputFiles(
	loaded: LoadedReport[],
	formatters: Formatters,
): Promise<WrittenOutputs> {
	const single = loaded.length === 1 ? loaded[0] : undefined;
	const dir = single
		? path.dirname(single.path)
		: path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), "gribble");
	await fs.mkdir(dir, { recursive: true });
	const sarif = mergeSarif(loaded.map((l) => formatters.toSarif(l.report)));
	const junit = mergeJUnit(loaded.map((l) => formatters.toJUnit(l.report)));
	const sarifPath = path.join(dir, "gribble.sarif");
	const junitPath = path.join(dir, "gribble-junit.xml");
	await fs.writeFile(sarifPath, `${JSON.stringify(sarif, null, 2)}\n`, "utf8");
	await fs.writeFile(junitPath, junit, "utf8");
	let reportPath = single?.path ?? "";
	if (!single) {
		reportPath = path.join(dir, "gribble-reports.json");
		await fs.writeFile(
			reportPath,
			`${JSON.stringify(
				loaded.map((l) => l.report),
				null,
				2,
			)}\n`,
			"utf8",
		);
	}
	core.info(`Wrote ${sarifPath} and ${junitPath}.`);
	return { sarifPath, junitPath, reportPath };
}

export function setActionOutputs(opts: {
	gate: "pass" | "fail";
	newFindings: number;
	reportPath: string;
	sarifPath: string;
}): void {
	core.setOutput("gate", opts.gate);
	core.setOutput("new-findings", String(opts.newFindings));
	core.setOutput("report-path", opts.reportPath);
	core.setOutput("sarif-path", opts.sarifPath);
}
