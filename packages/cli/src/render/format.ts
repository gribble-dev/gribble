import { completenessSummary, type Finding, type NotRunCheck, type Report } from "@gribble/core";
import type { Colors } from "../ui.js";

export const SEVERITY_ORDER = ["critical", "error", "warn", "info"] as const;

export function severityBadge(severity: Finding["severity"], c: Colors): string {
	const text = severity.padEnd(8);
	switch (severity) {
		case "critical":
			return c.bold(c.red(text));
		case "error":
			return c.red(text);
		case "warn":
			return c.yellow(text);
		case "info":
			return c.cyan(text);
	}
}

/** `file#symbol`, `file`, `selector` or nothing: the most stable locator a finding carries. */
export function locationLabel(finding: Finding): string | undefined {
	const loc = finding.location;
	if (!loc) return undefined;
	if (loc.file) return loc.symbol ? `${loc.file}#${loc.symbol}` : loc.file;
	if (loc.selector) return loc.selector;
	if (loc.path) return loc.path;
	return undefined;
}

/**
 * One finding on one line: badge, rule, route, title, location. Dry on purpose.
 * Column widths come from the caller so a list lines up.
 */
export function formatFinding(
	finding: Finding,
	c: Colors,
	widths: { rule: number; route: number } = { rule: 22, route: 14 },
): string {
	const parts = [
		"  ",
		severityBadge(finding.severity, c),
		" ",
		c.bold(finding.rule.padEnd(widths.rule)),
		" ",
		c.dim(finding.route.padEnd(widths.route)),
		" ",
		finding.title,
	];
	const where = locationLabel(finding);
	if (where) parts.push(" ", c.dim(`(${where})`));
	if (finding.source === "ai" && typeof finding.confidence === "number") {
		parts.push(" ", c.dim(`${Math.round(finding.confidence * 100)}%`));
	}
	return parts.join("");
}

export function columnWidths(findings: Finding[]): { rule: number; route: number } {
	let rule = 12;
	let route = 8;
	for (const f of findings) {
		rule = Math.max(rule, f.rule.length);
		route = Math.max(route, f.route.length);
	}
	return { rule: Math.min(rule, 32), route: Math.min(route, 28) };
}

export function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
	return String(tokens);
}

export function formatCost(usd: number): string {
	if (usd === 0) return "$0.00";
	if (usd < 0.01) return "<$0.01";
	return `$${usd.toFixed(2)}`;
}

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(1)}s`;
	const m = Math.floor(s / 60);
	return `${m}m ${Math.round(s % 60)}s`;
}

/** `critical 1 · error 2 · warn 3` for the severities that are non-zero. */
export function formatCounts(counts: Report["summary"]["counts"], c: Colors): string {
	const parts: string[] = [];
	for (const severity of SEVERITY_ORDER) {
		const n = counts[severity];
		if (n > 0) parts.push(`${severityBadge(severity, c).trimEnd()} ${n}`);
	}
	return parts.join(c.dim(" · "));
}

export function modelLabel(model: Report["model"]): string | undefined {
	if (!model) return undefined;
	return `${model.provider}/${model.id}${model.thinking ? `:${model.thinking}` : ""}`;
}

/**
 * Collapse the report's not-run checks into one group per reason: the distinct rules that share it
 * and the distinct routes they were skipped on. Site-wide checks carry no route.
 */
/**
 * The Execution / Findings / Baseline / Unreached block, labels aligned. Empty for reports written
 * before the completeness section existed.
 */
export function formatCompleteness(report: Report, c: Colors): string[] {
	const lines = completenessSummary(report);
	if (lines.length === 0) return [];
	const width = Math.max(...lines.map((l) => l.label.length)) + 1;
	return lines.map(({ label, text }) => {
		const tint =
			label === "Required"
				? c.red
				: label === "Unreached" || (label === "Execution" && text.startsWith("incomplete"))
					? c.yellow
					: (s: string) => s;
		return `  ${c.dim(`${label}:`.padEnd(width))} ${tint(text)}`;
	});
}

export function groupNotRun(
	entries: NotRunCheck[],
): Array<{ rules: string[]; routes: string[]; reason: string }> {
	const groups = new Map<string, { rules: Set<string>; routes: Set<string>; reason: string }>();
	for (const entry of entries) {
		const group = groups.get(entry.reason) ?? { rules: new Set(), routes: new Set(), reason: entry.reason };
		group.rules.add(entry.rule);
		if (entry.route) group.routes.add(entry.route);
		groups.set(entry.reason, group);
	}
	return [...groups.values()].map((g) => ({ rules: [...g.rules], routes: [...g.routes], reason: g.reason }));
}
