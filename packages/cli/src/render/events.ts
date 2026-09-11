import type { AuditEvent, Finding, Report } from "@gribble/core";
import { copy } from "../copy.js";
import type { PromptSpinner } from "../prompts.js";
import type { Ui } from "../ui.js";
import {
	columnWidths,
	formatCost,
	formatCounts,
	formatDuration,
	formatFinding,
	formatTokens,
	modelLabel,
} from "./format.js";

export interface RendererOptions {
	ui: Ui;
	/** `tty`: spinner plus live lines. `plain`: one line per event, no cursor movement (CI, --json, logs). */
	mode: "tty" | "plain";
	/** Spinner used in tty mode. Tests pass a recording fake. */
	spinner?: PromptSpinner;
	url: string;
	/** "" for a single-app repository. */
	targetName?: string;
	/** Model spec printed under the header, when review runs. */
	model?: string;
}

export interface FinishOptions {
	reportPath?: string;
	baselineUpdated?: boolean;
}

export interface EventRenderer {
	start(): void;
	onEvent(event: AuditEvent): void;
	finish(report: Report, opts?: FinishOptions): void;
	/** Stop the spinner and print a failure line; used before an error is reported. */
	abort(message?: string): void;
}

interface CategoryStats {
	checks: number;
	findings: number;
	routes: Set<string>;
}

const PHASE_LABEL: Record<string, string> = {
	prepare: "preparing",
	server: "starting the dev server",
	routes: "discovering routes",
	gate: "running deterministic checks",
	review: "reviewing",
	baseline: "comparing with the baseline",
	report: "writing the report",
};

/**
 * Turns the `AuditEvent` stream into terminal output. Findings print as they arrive; the gate
 * phase collapses into one summary line per rule category; the review phase shows what the
 * reviewer is doing. `finish` prints the headline, counts, ledger, report path and usage.
 */
export function createEventRenderer(opts: RendererOptions): EventRenderer {
	const { ui, mode } = opts;
	const c = ui.colors;
	const spinner = mode === "tty" ? opts.spinner : undefined;
	let spinning = false;
	let spinnerText = "";
	let phase: string | undefined;
	const categories = new Map<string, CategoryStats>();
	const routes = new Set<string>();
	const printed = new Set<string>();
	const live: Finding[] = [];
	let gateSummaryPrinted = false;
	let reviewToolCalls = 0;

	function spin(text: string) {
		spinnerText = text;
		if (!spinner) return;
		if (spinning) spinner.message(text);
		else {
			spinner.start(text);
			spinning = true;
		}
	}

	function pause() {
		if (spinner && spinning) {
			spinner.clear();
			spinning = false;
		}
	}

	function resume() {
		if (spinner && !spinning && spinnerText) {
			spinner.start(spinnerText);
			spinning = true;
		}
	}

	function line(text: string) {
		pause();
		ui.line(text);
		resume();
	}

	function plain(text: string) {
		if (mode === "plain") ui.line(text);
	}

	function tick(text: string) {
		if (mode === "tty") spin(text);
		else ui.line(text);
	}

	function printGateSummary() {
		if (gateSummaryPrinted || categories.size === 0) return;
		gateSummaryPrinted = true;
		pause();
		if (routes.size > 0) ui.line(`   ${c.green("✓")} ${"routes".padEnd(14)} ${routes.size} audited`);
		for (const [category, stats] of categories) {
			const what = stats.routes.size > 0 ? `${stats.routes.size} routes` : `${stats.checks} checks`;
			const holes = stats.findings > 0 ? c.dim(` · ${stats.findings} findings`) : "";
			ui.line(`   ${c.green("✓")} ${category.padEnd(14)} ${what}${holes}`);
		}
		resume();
	}

	function printFinding(finding: Finding) {
		if (printed.has(finding.fingerprint)) return;
		printed.add(finding.fingerprint);
		live.push(finding);
		line(formatFinding(finding, c));
	}

	return {
		start() {
			const header = opts.targetName
				? copy.audit.nibblingTarget(opts.targetName, opts.url)
				: copy.audit.nibbling(3, opts.url);
			ui.line(header);
			if (opts.model) ui.line(`   ${c.dim(copy.audit.modelReady(opts.model))}`);
		},

		onEvent(event) {
			switch (event.type) {
				case "phase": {
					if (phase === "gate" && event.phase !== "gate") printGateSummary();
					phase = event.phase;
					const label = PHASE_LABEL[event.phase] ?? event.phase;
					tick(mode === "tty" ? `${event.message || label}` : `[${event.phase}] ${event.message || label}`);
					return;
				}
				case "log": {
					if (event.level === "debug") {
						if (ui.verbose) line(c.dim(`   ${event.message}`));
						return;
					}
					if (event.level === "warn") line(`   ${c.yellow("!")} ${event.message}`);
					else if (event.level === "error") line(`   ${c.red("✗")} ${event.message}`);
					else if (mode === "plain" || ui.verbose) line(`   ${c.dim(event.message)}`);
					return;
				}
				case "route:start": {
					routes.add(event.route);
					const vp = event.viewport ? ` (${event.viewport})` : "";
					if (mode === "tty") spin(`nibbling on ${event.route}${vp}`);
					else plain(`route ${event.route}${vp}`);
					return;
				}
				case "route:end": {
					routes.add(event.route);
					if (ui.verbose && event.durationMs !== undefined) {
						plain(`route ${event.route} done in ${formatDuration(event.durationMs)}`);
					}
					return;
				}
				case "check:start": {
					if (mode === "tty") spin(`checking ${event.rule}${event.route ? ` on ${event.route}` : ""}`);
					return;
				}
				case "check:end": {
					const category = event.rule.split("/")[0] ?? event.rule;
					const stats = categories.get(category) ?? { checks: 0, findings: 0, routes: new Set<string>() };
					stats.checks++;
					stats.findings += event.findings ?? 0;
					if (event.route) stats.routes.add(event.route);
					categories.set(category, stats);
					if (ui.verbose || mode === "plain") {
						const took = event.durationMs !== undefined ? ` ${formatDuration(event.durationMs)}` : "";
						const found = event.findings ? ` · ${event.findings} findings` : "";
						plain(`   ✓ ${event.rule}${event.route ? ` ${event.route}` : ""}${took}${found}`);
					}
					return;
				}
				case "flow:start": {
					tick(mode === "tty" ? `walking flow ${event.flow}` : `flow ${event.flow}`);
					return;
				}
				case "flow:end": {
					const took = event.durationMs !== undefined ? c.dim(` ${formatDuration(event.durationMs)}`) : "";
					if (event.ok) line(`   ${c.green("✓")} flow ${event.flow}${took}`);
					else line(`   ${c.red("✗")} flow ${event.flow}${took}${event.error ? `: ${event.error}` : ""}`);
					return;
				}
				case "finding": {
					printFinding(event.finding);
					return;
				}
				case "agent": {
					const e = event.event as { type?: string; toolName?: string };
					if (e.type === "tool_execution_start") {
						reviewToolCalls++;
						const tool = e.toolName ?? "tool";
						if (mode === "tty") spin(`reviewing: ${tool} (${reviewToolCalls} steps)`);
						else if (ui.verbose) plain(`   agent ${tool}`);
					}
					return;
				}
				case "budget": {
					const text = `${event.steps}/${event.maxSteps} steps · ${formatTokens(event.tokens)}/${formatTokens(event.maxTokens)} tokens · ${formatCost(event.costUsd)}`;
					if (mode === "tty") spin(`reviewing (${text})`);
					else if (ui.verbose) plain(`   budget ${text}`);
					return;
				}
				case "done":
					if (phase === "gate") printGateSummary();
					return;
			}
		},

		finish(report, finishOpts = {}) {
			printGateSummary();
			pause();
			if (spinner && spinnerText) spinner.stop(c.dim("done"));
			spinning = false;
			spinnerText = "";

			const summary = report.summary;
			ui.line();
			const headline = summary.gate === "fail" ? c.bold(c.red(summary.headline)) : c.bold(summary.headline);
			ui.line(headline);

			const remaining = report.findings.filter((f) => f.status === "new" && !printed.has(f.fingerprint));
			if (remaining.length > 0 || live.length > 0) ui.line();
			if (remaining.length > 0) {
				const widths = columnWidths(remaining);
				for (const finding of remaining) {
					printed.add(finding.fingerprint);
					ui.line(formatFinding(finding, c, widths));
				}
			}

			ui.line();
			if (report.baseline.bootstrap) {
				ui.line(copy.audit.bootstrap(report.findings.length));
			} else {
				const counts = formatCounts(summary.counts, c);
				if (counts) ui.line(`  ${counts}`);
				const ledger = copy.audit.ledger(summary.existingCount, summary.fixedCount);
				if (ledger) ui.line(`  ${c.dim(ledger)}`);
			}
			if (finishOpts.baselineUpdated && !report.baseline.bootstrap)
				ui.line(`  ${copy.audit.baselineUpdated}`);
			if (finishOpts.reportPath) ui.line(`  ${c.dim(copy.audit.reportPath(finishOpts.reportPath))}`);
			const model = modelLabel(report.model);
			const usage = copy.audit.usage(
				report.budget.steps,
				formatTokens(report.budget.tokens),
				formatCost(report.budget.costUsd),
			);
			ui.line(
				`  ${c.dim(model ? `${usage} · ${model}` : usage)}${c.dim(` · ${formatDuration(report.durationMs)}`)}`,
			);
			if (summary.gate === "fail") ui.line(`  ${c.red(copy.audit.gateFailed)}`);
		},

		abort(message) {
			if (spinner && spinning) {
				spinner.error(message ?? "");
				spinning = false;
			} else if (message) ui.line(message);
		},
	};
}
