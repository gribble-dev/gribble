import type { ResolvedRules } from "../config/resolve.js";
import { normalizeRoute } from "./fingerprint.js";
import type { Finding, FindingSeverity } from "./schema.js";

export const SEVERITY_RANK: Record<FindingSeverity, number> = { critical: 4, error: 3, warn: 2, info: 1 };

/** Fuzzy title similarity threshold for AI findings. */
export const FUZZY_TITLE_THRESHOLD = 0.85;

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()
		.replace(/\s+/g, " ");
}

function bigrams(text: string): Map<string, number> {
	const out = new Map<string, number>();
	for (let i = 0; i < text.length - 1; i++) {
		const gram = text.slice(i, i + 2);
		out.set(gram, (out.get(gram) ?? 0) + 1);
	}
	return out;
}

/** Sørensen–Dice coefficient over character bigrams, 0..1. */
export function diceCoefficient(a: string, b: string): number {
	if (a === b) return 1;
	if (a.length < 2 || b.length < 2) return 0;
	const ga = bigrams(a);
	const gb = bigrams(b);
	let overlap = 0;
	for (const [gram, count] of ga) {
		const other = gb.get(gram);
		if (other) overlap += Math.min(count, other);
	}
	return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

function higher(a: Finding, b: Finding): Finding {
	return SEVERITY_RANK[b.severity] > SEVERITY_RANK[a.severity] ? b : a;
}

/**
 * Remove duplicates. Exact duplicates share a fingerprint (the higher severity wins).
 * AI findings are additionally collapsed when they share route and rule and their normalized
 * titles have a bigram Dice similarity of at least 0.85.
 */
export function dedupeFindings(findings: Finding[]): Finding[] {
	const byFingerprint = new Map<string, Finding>();
	for (const finding of findings) {
		const existing = byFingerprint.get(finding.fingerprint);
		byFingerprint.set(finding.fingerprint, existing ? higher(existing, finding) : finding);
	}
	const result: Finding[] = [];
	const aiSeen: Array<{ route: string; rule: string; title: string; index: number }> = [];
	for (const finding of byFingerprint.values()) {
		if (finding.source !== "ai") {
			result.push(finding);
			continue;
		}
		const route = normalizeRoute(finding.route);
		const title = normalizeTitle(finding.title);
		const match = aiSeen.find(
			(s) =>
				s.route === route &&
				s.rule === finding.rule &&
				diceCoefficient(s.title, title) >= FUZZY_TITLE_THRESHOLD,
		);
		if (match) {
			const kept = result[match.index];
			if (kept) result[match.index] = higher(kept, finding);
			continue;
		}
		aiSeen.push({ route, rule: finding.rule, title, index: result.length });
		result.push(finding);
	}
	return result;
}

function confidenceOf(finding: Finding): number {
	return finding.source === "deterministic" ? 1 : (finding.confidence ?? 0);
}

/** Severity desc, confidence desc, deterministic before AI, then rule, route and title for stability. */
export function sortFindings(findings: Finding[]): Finding[] {
	return [...findings].sort((a, b) => {
		const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
		if (bySeverity !== 0) return bySeverity;
		const byConfidence = confidenceOf(b) - confidenceOf(a);
		if (byConfidence !== 0) return byConfidence;
		if (a.source !== b.source) return a.source === "deterministic" ? -1 : 1;
		return a.rule.localeCompare(b.rule) || a.route.localeCompare(b.route) || a.title.localeCompare(b.title);
	});
}

/**
 * Cap an AI finding's severity at the severity of its `review/*` rule for the finding's route.
 * A rule set to `off` caps at `info` (callers that want to drop such findings use `applyRulePolicy`).
 * Deterministic findings are returned unchanged.
 */
export function capSeverity(finding: Finding, rules: ResolvedRules): Finding {
	if (finding.source !== "ai") return finding;
	const { severity } = rules.get(finding.rule, finding.route);
	const cap: FindingSeverity = severity === "off" ? "info" : severity;
	if (SEVERITY_RANK[finding.severity] <= SEVERITY_RANK[cap]) return finding;
	return { ...finding, severity: cap };
}

/**
 * Apply rules.yaml policy to raw findings: drop ignored fingerprints, drop findings whose rule is
 * `off` for their route, drop AI findings below `minConfidence`, and cap AI severities.
 */
export function applyRulePolicy(
	findings: Finding[],
	rules: ResolvedRules,
	opts: { minConfidence?: number } = {},
): Finding[] {
	const minConfidence = opts.minConfidence ?? 0;
	const out: Finding[] = [];
	for (const finding of findings) {
		if (rules.ignore.has(finding.fingerprint)) continue;
		const { severity } = rules.get(finding.rule, finding.route);
		if (severity === "off") continue;
		if (finding.source === "ai" && (finding.confidence ?? 0) < minConfidence) continue;
		out.push(capSeverity(finding, rules));
	}
	return out;
}
