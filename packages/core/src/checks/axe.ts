/**
 * a11y/axe — axe-core over the current page. Selected axe rules are re-homed onto dedicated
 * Gribble rules (img-alt, form-labels, accessible-name, color-contrast) when those are enabled.
 */
import { AxeBuilder } from "@axe-core/playwright";
import type { Finding } from "../report/schema.js";
import { report, ruleEnabled, ruleOptions, truncate } from "./finding.js";
import type { CheckContext } from "./types.js";

const AXE_RULE_MAP: Record<string, string> = {
	"image-alt": "a11y/img-alt",
	"input-image-alt": "a11y/img-alt",
	label: "a11y/form-labels",
	"select-name": "a11y/form-labels",
	"button-name": "a11y/accessible-name",
	"link-name": "a11y/accessible-name",
	"color-contrast": "a11y/color-contrast",
	"color-contrast-enhanced": "a11y/color-contrast",
};

const MAX_FINDINGS_PER_RULE = 20;

function nodeSelector(target: unknown): string {
	if (typeof target === "string") return target;
	if (Array.isArray(target)) {
		const first = target[0];
		if (typeof first === "string") return first;
		if (Array.isArray(first)) return first.map(String).join(" >> ");
	}
	return String(target ?? "");
}

/** a11y/axe plus the mapped rules. */
export async function runAxe(ctx: CheckContext): Promise<Finding[]> {
	const out: Finding[] = [];
	const mapped = Object.values(AXE_RULE_MAP);
	const axeOn = ruleEnabled(ctx, "a11y/axe");
	if (!axeOn && !mapped.some((r) => ruleEnabled(ctx, r))) return out;

	const options = ruleOptions<{ impact: string[]; tags: string[]; disable: string[] }>(ctx, "a11y/axe");
	const impacts = new Set(options.impact ?? ["critical", "serious"]);
	const tags = options.tags ?? ["wcag2a", "wcag2aa"];
	const disable = options.disable ?? [];
	if (ruleEnabled(ctx, "a11y/color-contrast")) {
		const level = ruleOptions<{ level: string }>(ctx, "a11y/color-contrast").level;
		if (level === "AAA" && !tags.includes("wcag2aaa")) tags.push("wcag2aaa");
	}

	let results: Awaited<ReturnType<AxeBuilder["analyze"]>>;
	try {
		const builder = new AxeBuilder({ page: ctx.page.raw }).withTags(tags);
		if (disable.length) builder.disableRules(disable);
		results = await builder.analyze();
	} catch (err) {
		ctx.onEvent?.({
			type: "log",
			level: "warn",
			message: `axe could not run on ${ctx.route}: ${(err as Error).message}`,
		});
		return out;
	}

	for (const violation of results.violations) {
		const mappedRule = AXE_RULE_MAP[violation.id];
		const rule = mappedRule && ruleEnabled(ctx, mappedRule) ? mappedRule : "a11y/axe";
		if (rule === "a11y/axe") {
			if (!axeOn) continue;
			if (violation.impact && !impacts.has(violation.impact)) continue;
		}
		const nodes = violation.nodes.slice(0, MAX_FINDINGS_PER_RULE);
		for (const node of nodes) {
			const selector = nodeSelector(node.target);
			const summary = node.failureSummary
				?.replace(/^Fix (any|all) of the following:\s*/i, "")
				.replace(/\s+/g, " ")
				.trim();
			report(ctx, out, rule, {
				title: `${violation.help} (${violation.id})`,
				message: `${violation.description}${summary ? ` — ${summary}` : ""}${violation.impact ? ` Impact: ${violation.impact}.` : ""}`,
				subject: rule === "a11y/axe" ? violation.id : selector,
				location: { selector },
				suggestion: violation.helpUrl ? `See ${violation.helpUrl}` : undefined,
				evidence: {
					snippet: truncate(node.html, 300),
					url: violation.helpUrl,
					data: { axeRule: violation.id, impact: violation.impact, tags: violation.tags },
				},
			});
		}
		if (violation.nodes.length > nodes.length) {
			ctx.onEvent?.({
				type: "log",
				level: "debug",
				message: `axe ${violation.id} on ${ctx.route}: ${violation.nodes.length - nodes.length} more node(s) not reported.`,
			});
		}
	}
	return out;
}
