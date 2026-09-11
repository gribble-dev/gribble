/**
 * Shared finding factory for deterministic checks. Severity comes from rules.yaml (per route),
 * docs links from the registry, fingerprints from `computeFingerprint`.
 */
import type { Severity } from "../config/types.js";
import { computeFingerprint, normalizeRoute } from "../report/fingerprint.js";
import type { Finding, FindingLocation } from "../report/schema.js";
import { getRule } from "../rules/registry.js";
import type { CheckContext } from "./types.js";

export interface FindingInput {
	title: string;
	message: string;
	subject?: string;
	location?: FindingLocation;
	suggestion?: string;
	evidence?: Finding["evidence"];
	/** Override the context viewport (e.g. site-wide findings carry none). */
	viewport?: string | null;
}

/** Effective severity for a rule on a route, `off` when disabled or unknown. */
export function ruleSeverity(ctx: Pick<CheckContext, "project" | "route">, rule: string): Severity {
	return ctx.project.rules.get(rule, ctx.route).severity;
}

export function ruleOptions<T extends Record<string, unknown>>(
	ctx: Pick<CheckContext, "project" | "route">,
	rule: string,
): T {
	return ctx.project.rules.get(rule, ctx.route).options as T;
}

/** True when the rule produces findings on this route. */
export function ruleEnabled(ctx: Pick<CheckContext, "project" | "route">, rule: string): boolean {
	return ruleSeverity(ctx, rule) !== "off";
}

function compact(location?: FindingLocation): FindingLocation | undefined {
	if (!location) return undefined;
	const out: FindingLocation = {};
	if (location.file) out.file = location.file;
	if (location.symbol) out.symbol = location.symbol;
	if (location.selector) out.selector = location.selector;
	if (location.path) out.path = location.path;
	return Object.keys(out).length ? out : undefined;
}

/** Build a deterministic finding; returns undefined when the rule is off for the route. */
export function makeFinding(
	ctx: Pick<CheckContext, "project" | "route" | "targetName" | "viewport">,
	rule: string,
	input: FindingInput,
): Finding | undefined {
	const severity = ruleSeverity(ctx, rule);
	if (severity === "off") return undefined;
	const meta = getRule(rule);
	const route = normalizeRoute(ctx.route);
	const location = compact(input.location);
	const finding: Finding = {
		fingerprint: computeFingerprint({
			rule,
			targetName: ctx.targetName,
			route,
			location,
			subject: input.subject,
		}),
		rule,
		severity,
		source: "deterministic",
		status: "new",
		title: input.title,
		message: input.message,
		route,
		docsUrl: meta?.docsUrl ?? `https://gribble.dev/rules/${rule}`,
	};
	const viewport = input.viewport === undefined ? ctx.viewport : input.viewport;
	if (viewport) finding.viewport = viewport;
	if (location) finding.location = location;
	if (input.subject !== undefined) finding.subject = input.subject;
	const suggestion = input.suggestion ?? meta?.fix;
	if (suggestion) finding.suggestion = suggestion;
	if (input.evidence && Object.keys(input.evidence).length > 0) finding.evidence = input.evidence;
	return finding;
}

/** Push a finding when the rule is on and emit the `finding` event. */
export function report(
	ctx: Pick<CheckContext, "project" | "route" | "targetName" | "viewport" | "onEvent">,
	out: Finding[],
	rule: string,
	input: FindingInput,
): Finding | undefined {
	const finding = makeFinding(ctx, rule, input);
	if (!finding) return undefined;
	out.push(finding);
	ctx.onEvent?.({ type: "finding", finding });
	return finding;
}

/** Shorten a string for titles and subjects. */
export function truncate(text: string, max = 80): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

/** Compile user patterns: `/regex/flags` literals, strings with regex metacharacters, or substrings. */
export function compilePatterns(patterns: readonly string[], opts: { word?: boolean } = {}): RegExp[] {
	const out: RegExp[] = [];
	for (const raw of patterns) {
		const literal = raw.match(/^\/(.+)\/([a-z]*)$/);
		try {
			if (literal) {
				out.push(new RegExp(literal[1]!, literal[2] || undefined));
			} else if (/[\\^$.*+?()[\]{}|]/.test(raw)) {
				out.push(new RegExp(raw, "i"));
			} else {
				const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
				const caseSensitive = raw === raw.toUpperCase() && /[A-Z]/.test(raw);
				out.push(new RegExp(opts.word ? `\\b${escaped}\\b` : escaped, caseSensitive ? "" : "i"));
			}
		} catch {
			// invalid pattern: ignore it rather than crash the audit
		}
	}
	return out;
}
