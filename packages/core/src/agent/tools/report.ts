/**
 * Report pack: structured findings and the terminating summary. Fingerprints and locations are
 * computed here, never by the model.
 */
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { locationFor, mapDomToSource } from "../../repo/index.js";
import { diceCoefficient, FUZZY_TITLE_THRESHOLD, normalizeTitle } from "../../report/findings.js";
import { computeFingerprint, normalizeRoute } from "../../report/fingerprint.js";
import { FINDING_SEVERITIES, type Finding, type FindingLocation } from "../../report/schema.js";
import { isRuleId, RULE_IDS } from "../../rules/ids.js";
import { RULES_DOCS_BASE_URL } from "../../rules/registry.js";
import { REPORT_TOOLS } from "../names.js";
import type { AgentState } from "../state.js";
import { textResult } from "./common.js";
import { discoveredRoutesFor } from "./repo.js";

export const REVIEW_RULE_IDS = RULE_IDS.filter((id) => id.startsWith("review/"));

export const ADD_FINDING_PARAMS = Type.Object({
	rule: StringEnum(REVIEW_RULE_IDS as unknown as readonly string[], {
		description: "Category of the problem; one of the review/* rules.",
	}),
	route: Type.String({ description: "Route where it happens, e.g. /pricing or /blog/[slug]." }),
	title: Type.String({ description: "One short, dry sentence.", minLength: 3 }),
	severity: StringEnum(FINDING_SEVERITIES, {
		description: "What the problem deserves; the project's rules cap it.",
	}),
	confidence: Type.Number({
		description: "0 to 1. Low-confidence findings are dropped.",
		minimum: 0,
		maximum: 1,
	}),
	message: Type.String({ description: "What you observed, where, and why it is a problem." }),
	subject: Type.Optional(
		Type.String({
			description:
				"The specific thing that is wrong (element, text, link target). Keeps fingerprints stable.",
		}),
	),
	suggestion: Type.Optional(Type.String({ description: "A concrete fix." })),
	location: Type.Optional(
		Type.Object(
			{
				file: Type.Optional(Type.String({ description: "Source file relative to the repo root." })),
				symbol: Type.Optional(
					Type.String({ description: "Component or function name in that file. Never a line number." }),
				),
				selector: Type.Optional(
					Type.String({ description: "Stable selector: data-testid, id, or role+name." }),
				),
				path: Type.Optional(Type.String({ description: "Structural DOM path, last resort." })),
			},
			{ additionalProperties: false },
		),
	),
	element: Type.Optional(
		Type.Object(
			{
				testId: Type.Optional(Type.String({ description: "data-testid of the element." })),
				id: Type.Optional(Type.String({ description: "DOM id of the element." })),
				text: Type.Optional(Type.String({ description: "Unique visible text of the element." })),
				className: Type.Optional(Type.String({ description: "A distinctive class name." })),
			},
			{
				additionalProperties: false,
				description: "Identifiers of the element; used to map it to source when no file is given.",
			},
		),
	),
	viewport: Type.Optional(
		Type.String({ description: "Viewport the problem was seen in; default the current one." }),
	),
	evidence: Type.Optional(
		Type.Object(
			{
				snippet: Type.Optional(Type.String({ description: "Relevant text or HTML excerpt." })),
				url: Type.Optional(Type.String({ description: "URL involved." })),
			},
			{ additionalProperties: false },
		),
	),
});

export type AddFindingInput = Static<typeof ADD_FINDING_PARAMS>;

function selectorFor(el: AddFindingInput["element"]): string | undefined {
	if (!el) return undefined;
	if (el.testId) return `[data-testid="${el.testId}"]`;
	if (el.id) return `#${el.id}`;
	return undefined;
}

/** Resolve the finding location: explicit file wins, then a source match, then a stable selector. */
export async function resolveLocation(
	state: AgentState,
	input: AddFindingInput,
	route: string,
): Promise<FindingLocation | undefined> {
	const given = input.location;
	if (given?.file) return given;
	const fallback = { selector: given?.selector ?? selectorFor(input.element), path: given?.path };
	const el = input.element;
	if (el && (el.testId || el.id || el.text || el.className)) {
		try {
			const discovered = await discoveredRoutesFor(state).catch(() => undefined);
			const matches = await mapDomToSource({
				targetDir: state.project.targetDir,
				testId: el.testId,
				id: el.id,
				text: el.text,
				className: el.className,
				route,
				routeSource: discovered?.source,
			});
			return locationFor(matches[0], fallback);
		} catch (err) {
			state.log("debug", `map_dom_to_source failed: ${(err as Error).message}`);
		}
	}
	if (given?.symbol && !fallback.selector && !fallback.path) return { symbol: given.symbol };
	if (!fallback.selector && !fallback.path) return undefined;
	const location: FindingLocation = {};
	if (fallback.selector) location.selector = fallback.selector;
	if (fallback.path) location.path = fallback.path;
	return location;
}

/** An existing AI finding on the same route and rule whose title is nearly the same. */
export function findFuzzyDuplicate(
	existing: readonly Finding[],
	candidate: { route: string; rule: string; title: string },
): Finding | undefined {
	const title = normalizeTitle(candidate.title);
	return existing.find(
		(f) =>
			f.source === "ai" &&
			f.rule === candidate.rule &&
			f.route === candidate.route &&
			diceCoefficient(normalizeTitle(f.title), title) >= FUZZY_TITLE_THRESHOLD,
	);
}

/** Build a finding from validated tool input. Exported for tests. */
export async function buildFinding(state: AgentState, input: AddFindingInput): Promise<Finding> {
	if (!isRuleId(input.rule) || !input.rule.startsWith("review/")) {
		throw new Error(`rule must be one of ${REVIEW_RULE_IDS.join(", ")}; got "${input.rule}".`);
	}
	if (!(input.confidence >= 0 && input.confidence <= 1)) {
		throw new Error(`confidence must be between 0 and 1; got ${input.confidence}.`);
	}
	const route = normalizeRoute(input.route);
	const location = await resolveLocation(state, input, route);
	const subject = input.subject?.trim() || undefined;
	const fingerprint = computeFingerprint({
		rule: input.rule,
		targetName: state.targetName,
		route,
		location,
		subject: subject ?? input.title,
	});
	const finding: Finding = {
		fingerprint,
		rule: input.rule,
		severity: input.severity,
		source: "ai",
		confidence: input.confidence,
		status: "new",
		title: input.title.trim(),
		message: input.message.trim(),
		route,
		docsUrl: `${RULES_DOCS_BASE_URL}/${input.rule}`,
	};
	const viewport = input.viewport ?? state.lastSnapshotViewport ?? state.currentViewport;
	if (viewport) finding.viewport = viewport;
	if (location) finding.location = location;
	if (subject) finding.subject = subject;
	if (input.suggestion?.trim()) finding.suggestion = input.suggestion.trim();
	if (input.evidence && (input.evidence.snippet || input.evidence.url)) {
		finding.evidence = {};
		if (input.evidence.snippet) finding.evidence.snippet = input.evidence.snippet;
		if (input.evidence.url) finding.evidence.url = input.evidence.url;
	}
	return finding;
}

export function reportPack(state: AgentState): InlineExtension {
	return {
		name: "gribble-report",
		factory: (pi: ExtensionAPI) => {
			pi.registerTool({
				name: REPORT_TOOLS.addFinding,
				label: "Add finding",
				description:
					"Record one problem. Fingerprints are computed from rule, route, location and subject, so fill them precisely. One problem per call; duplicates are rejected.",
				promptSnippet: "Record a problem as a structured finding",
				parameters: ADD_FINDING_PARAMS,
				async execute(_id, params) {
					const finding = await buildFinding(state, params);
					const exact = state.findings.find((f) => f.fingerprint === finding.fingerprint);
					if (exact) {
						return textResult(`Already recorded as ${exact.fingerprint} ("${exact.title}"); not added.`, {
							duplicate: exact.fingerprint,
							finding,
						});
					}
					const fuzzy = findFuzzyDuplicate(state.findings, finding);
					if (fuzzy) {
						return textResult(
							`Looks like ${fuzzy.fingerprint} ("${fuzzy.title}") on the same route; not added.`,
							{
								duplicate: fuzzy.fingerprint,
								finding,
							},
						);
					}
					state.addFinding(finding);
					const where = finding.location?.file
						? ` at ${finding.location.file}${finding.location.symbol ? `#${finding.location.symbol}` : ""}`
						: finding.location?.selector
							? ` at ${finding.location.selector}`
							: "";
					return textResult(
						`Recorded ${finding.fingerprint}: ${finding.severity} ${finding.rule} ${finding.route}${where} — ${finding.title} (${state.findings.length} total)`,
						{ finding },
					);
				},
			});

			pi.registerTool({
				name: REPORT_TOOLS.finalizeReport,
				label: "Finalize report",
				description:
					"End the audit. Call it once every flow is walked and the routes are covered, or when the budget runs low. Nothing runs after it.",
				promptSnippet: "Finish the audit with a short summary",
				parameters: Type.Object({
					summary: Type.String({ description: "Two sentences: what you checked and the overall state." }),
				}),
				async execute(_id, params) {
					state.finalized = true;
					state.summary = params.summary.trim();
					if (state.flowRecording) {
						const name = state.flowRecording.name;
						state.flowResults.push({
							name,
							ok: false,
							kind: "ai",
							durationMs: Date.now() - state.flowRecording.startedAt,
							error: "finalize_report was called before flow_end",
							steps: state.flowRecording.steps.length,
						});
						state.emit({ type: "flow:end", flow: name, ok: false, error: "not ended" });
						state.flowRecording = undefined;
					}
					return textResult(
						`Report finalized with ${state.findings.length} finding(s) and ${state.flowResults.length} flow result(s).`,
						{ summary: state.summary, findings: state.findings.length, flows: state.flowResults.length },
						{ terminate: true },
					);
				},
			});
		},
	};
}
