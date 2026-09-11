import { expandRuleWildcard, isRuleWildcard, RULE_IDS } from "../rules/ids.js";
import { isPresetId, PRESET_IDS, PRESETS } from "../rules/presets.js";
import { getRule, RULES } from "../rules/registry.js";
import { globMatch } from "../util/index.js";
import { ConfigError } from "./errors.js";
import type { RuleOverride, RuleSetting, RulesConfig, Severity } from "./types.js";

export interface ResolvedRuleSetting {
	severity: Severity;
	options: Record<string, unknown>;
}

export interface ResolvedRuleEntry extends ResolvedRuleSetting {
	id: string;
}

/** The effective rule configuration after presets, cascade and overrides. */
export interface ResolvedRules {
	/** Effective setting for a rule, optionally for a specific route (applies `overrides`). Unknown ids are `off`. */
	get(ruleId: string, route?: string): ResolvedRuleSetting;
	/** Suppressed finding fingerprints from every `ignore` list in the cascade. */
	ignore: Set<string>;
	/** Base settings (no route overrides). Rules set to `off` are omitted unless `includeOff` is true. */
	entries(opts?: { includeOff?: boolean }): ResolvedRuleEntry[];
	/** The override blocks in cascade order, for tooling that needs to list them. */
	overrides: RuleOverride[];
}

type Table = Map<string, ResolvedRuleSetting>;

function cloneTable(table: Table): Table {
	return new Map(
		[...table.entries()].map(([id, s]) => [id, { severity: s.severity, options: { ...s.options } }]),
	);
}

function apply(table: Table, id: string, setting: RuleSetting): void {
	const current = table.get(id) ?? { severity: "off", options: { ...(getRule(id)?.defaultOptions ?? {}) } };
	if (typeof setting === "string") {
		// A bare severity keeps the options configured so far (ESLint semantics).
		table.set(id, { severity: setting, options: current.options });
	} else {
		const [severity, options] = setting;
		table.set(id, { severity, options: { ...(getRule(id)?.defaultOptions ?? {}), ...options } });
	}
}

/** Apply a rules block: wildcards first, then explicit ids, so explicit ids win regardless of YAML order. */
function applyBlock(table: Table, rules: Record<string, RuleSetting>): void {
	for (const [key, setting] of Object.entries(rules)) {
		if (!isRuleWildcard(key)) continue;
		for (const id of expandRuleWildcard(key)) apply(table, id, setting);
	}
	for (const [key, setting] of Object.entries(rules)) {
		if (isRuleWildcard(key)) continue;
		apply(table, key, setting);
	}
}

/**
 * Resolve the cascade. `configs` are ordered root first, app last: each config's presets are applied,
 * then its `rules`, on top of everything before it. Overrides are collected in the same order and
 * applied per route by `get(id, route)`.
 */
export function resolveRules(configs: RulesConfig[]): ResolvedRules {
	const table: Table = new Map();
	for (const rule of RULES) {
		table.set(rule.id, { severity: "off", options: { ...(rule.defaultOptions ?? {}) } });
	}
	const ignore = new Set<string>();
	const overrides: RuleOverride[] = [];

	for (const config of configs) {
		for (const preset of config.extends ?? []) {
			if (!isPresetId(preset)) {
				throw new ConfigError(`unknown preset "${preset}". Available: ${PRESET_IDS.join(", ")}`, {
					file: "rules.yaml",
					path: "extends",
				});
			}
			applyBlock(table, PRESETS[preset]);
		}
		applyBlock(table, config.rules);
		for (const fp of config.ignore) ignore.add(fp);
		overrides.push(...config.overrides.map((o) => ({ routes: [...o.routes], rules: { ...o.rules } })));
	}

	const routeCache = new Map<string, Table>();
	const tableForRoute = (route: string): Table => {
		const cached = routeCache.get(route);
		if (cached) return cached;
		const matching = overrides.filter((o) => globMatch(route, o.routes));
		if (matching.length === 0) {
			routeCache.set(route, table);
			return table;
		}
		const scoped = cloneTable(table);
		for (const override of matching) applyBlock(scoped, override.rules);
		routeCache.set(route, scoped);
		return scoped;
	};

	return {
		ignore,
		overrides,
		get(ruleId, route) {
			const source = route ? tableForRoute(route) : table;
			const found = source.get(ruleId);
			return found
				? { severity: found.severity, options: { ...found.options } }
				: { severity: "off", options: {} };
		},
		entries(opts) {
			const out: ResolvedRuleEntry[] = [];
			for (const id of RULE_IDS) {
				const setting = table.get(id);
				if (!setting) continue;
				if (setting.severity === "off" && !opts?.includeOff) continue;
				out.push({ id, severity: setting.severity, options: { ...setting.options } });
			}
			return out;
		},
	};
}
