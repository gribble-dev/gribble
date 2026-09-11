/**
 * Builds the summary markdown used by the PR summary comment and the check run.
 */
import type { Formatters } from "./core.js";
import type { FailDecision } from "./fail.js";
import { type LoadedReport, SUMMARY_MARKER } from "./types.js";

export interface SummaryOptions {
	maxComments: number;
	reportUrl?: string;
	checkUrl?: string;
	decision?: FailDecision;
	failOn?: string;
}

function stripMarker(body: string): string {
	return body.split(SUMMARY_MARKER).join("").trim();
}

/** One summary for all targets: a single marker on top, one section per app. */
export function buildSummaryMarkdown(
	loaded: LoadedReport[],
	formatters: Formatters,
	opts: SummaryOptions,
): string {
	const parts: string[] = [SUMMARY_MARKER];
	const multi = loaded.length > 1;
	if (multi) {
		const totals = loaded.reduce(
			(acc, l) => {
				acc.newCount += l.report.summary.newCount;
				acc.existingCount += l.report.summary.existingCount;
				acc.fixedCount += l.report.summary.fixedCount;
				if (l.report.summary.gate === "fail") acc.failed += 1;
				return acc;
			},
			{ newCount: 0, existingCount: 0, fixedCount: 0, failed: 0 },
		);
		parts.push(
			`## 🐛 Gribble: ${loaded.length} apps audited, ${totals.failed === 0 ? "all gates passed" : `${totals.failed} gate(s) failed`}`,
		);
		parts.push("");
		parts.push(`${totals.newCount} new · ${totals.existingCount} existing · ${totals.fixedCount} fixed`);
		parts.push("");
	}
	for (const l of loaded) {
		const body = formatters.toMarkdownSummary(l.report, {
			maxComments: opts.maxComments,
			...(opts.reportUrl ? { reportUrl: opts.reportUrl } : {}),
		});
		let section = stripMarker(body);
		if (multi) {
			const name = l.report.target.name || l.report.target.url;
			// Demote headings so the per-app section nests under the combined title.
			section = `### ${name}\n\n${section.replace(/^(#{1,4}) /gm, (_m, hashes: string) => `${"#".repeat(Math.min(hashes.length + 1, 6))} `)}`;
		}
		parts.push(section);
		parts.push("");
	}
	if (opts.decision && opts.failOn) {
		parts.push(
			opts.decision.fail
				? `⛔ Step failed: ${opts.decision.reason} (fail-on: ${opts.failOn})`
				: `✅ Step passed: ${opts.decision.reason} (fail-on: ${opts.failOn})`,
		);
		parts.push("");
	}
	if (opts.checkUrl) {
		parts.push(`[Check run with annotations](${opts.checkUrl})`);
		parts.push("");
	}
	return `${parts.join("\n").trimEnd()}\n`;
}

/** Check run title: dry and short. */
export function checkTitle(loaded: LoadedReport[], decision: FailDecision): string {
	const newCount = loaded.reduce((n, l) => n + l.report.summary.newCount, 0);
	const fixed = loaded.reduce((n, l) => n + l.report.summary.fixedCount, 0);
	if (decision.fail) return `${decision.count} blocking finding${decision.count === 1 ? "" : "s"}`;
	if (newCount === 0)
		return fixed > 0 ? `No new findings, ${fixed} fixed` : "The gribbles went hungry. Ship it.";
	return `${newCount} new finding${newCount === 1 ? "" : "s"}, none blocking`;
}
