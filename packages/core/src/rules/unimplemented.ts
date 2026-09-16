import type { ResolvedRules } from "../config/resolve.js";
import { expandRuleWildcard, isRuleWildcard, RULE_IDS } from "./ids.js";
import { getRule } from "./registry.js";

/**
 * Rules that are switched on (base setting or any route override) but whose registry entry has
 * no checker yet (`implemented: false`), in registry order. They validate and resolve like any other
 * rule and then produce nothing, so the audit warns about them instead of staying silent.
 */
export function unimplementedEnabledRules(rules: ResolvedRules): string[] {
	const enabled = new Set<string>();
	for (const entry of rules.entries()) enabled.add(entry.id);
	for (const override of rules.overrides) {
		for (const [key, setting] of Object.entries(override.rules)) {
			const severity = typeof setting === "string" ? setting : setting[0];
			if (severity === "off") continue;
			for (const id of isRuleWildcard(key) ? expandRuleWildcard(key) : [key]) enabled.add(id);
		}
	}
	// The environment map is applied after the route overrides, so it has the last word for those too.
	// Wildcards first, explicit ids second, the way the resolver applies a block.
	const environment = Object.entries(rules.environment?.rules ?? {});
	const ordered = [
		...environment.filter(([k]) => isRuleWildcard(k)),
		...environment.filter(([k]) => !isRuleWildcard(k)),
	];
	for (const [key, setting] of ordered) {
		const severity = typeof setting === "string" ? setting : setting[0];
		for (const id of isRuleWildcard(key) ? expandRuleWildcard(key) : [key]) {
			if (severity === "off") enabled.delete(id);
			else enabled.add(id);
		}
	}
	return RULE_IDS.filter((id) => enabled.has(id) && getRule(id)?.implemented === false);
}

/** One warn line for audit startup naming the enabled rules that will not run; undefined when there are none. */
export function formatUnimplementedRulesWarning(ids: string[]): string | undefined {
	if (ids.length === 0) return undefined;
	const noun = ids.length === 1 ? "1 enabled rule has" : `${ids.length} enabled rules have`;
	return `${noun} no checker yet and will not run: ${ids.join(", ")}. Planned (accepted in rules.yaml, no checker yet); see gribble explain <rule>.`;
}
