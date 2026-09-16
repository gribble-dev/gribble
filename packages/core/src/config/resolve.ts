import { expandRuleWildcard, isRuleWildcard, RULE_IDS } from "../rules/ids.js";
import { isPresetId, PRESET_IDS, PRESETS, type PresetId } from "../rules/presets.js";
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

/** Where a rule's base setting was last set, for `gribble explain` and similar tooling. */
export type RuleSource =
	/** Nothing set it: `off` with the registry defaults. */
	| { kind: "default" }
	/** A preset listed in `extends` of the `level`-th rules.yaml in the cascade (root first). */
	| { kind: "preset"; preset: PresetId; level: number }
	/** The `rules` block of the `level`-th rules.yaml in the cascade; `key` is the id or wildcard used. */
	| { kind: "rules"; level: number; key: string }
	/** `environments.<environment>.rules` in gribble.yaml; `key` is the id or wildcard used. */
	| { kind: "environment"; environment: string; key: string };

/** `environments.<name>.rules` of the selected environment, applied after everything in rules.yaml. */
export interface RulesEnvironmentOverride {
	name: string;
	rules: Record<string, RuleSetting>;
}

export interface ResolveRulesOptions {
	environment?: RulesEnvironmentOverride;
}

/** The effective rule configuration after presets, cascade, overrides and the selected environment. */
export interface ResolvedRules {
	/** Effective setting for a rule, optionally for a specific route (applies `overrides`). Unknown ids are `off`. */
	get(ruleId: string, route?: string): ResolvedRuleSetting;
	/** Suppressed finding fingerprints from every `ignore` list in the cascade. */
	ignore: Set<string>;
	/** Base settings (no route overrides). Rules set to `off` are omitted unless `includeOff` is true. */
	entries(opts?: { includeOff?: boolean }): ResolvedRuleEntry[];
	/** The override blocks in cascade order, for tooling that needs to list them. */
	overrides: RuleOverride[];
	/** Where the base setting of a rule came from (route overrides are not tracked). */
	source(ruleId: string): RuleSource;
	/** The environment rules that were applied last, when an environment with `rules` was selected. */
	environment?: RulesEnvironmentOverride;
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

/**
 * Apply a rules block: wildcards first, then explicit ids, so explicit ids win regardless of YAML order.
 * `sources`, when given, records `sourceFor(key)` against every rule the block touches.
 */
function applyBlock(
	table: Table,
	rules: Record<string, RuleSetting>,
	sources?: Map<string, RuleSource>,
	sourceFor?: (key: string) => RuleSource,
): void {
	const record = (id: string, key: string) => {
		if (sources && sourceFor) sources.set(id, sourceFor(key));
	};
	for (const [key, setting] of Object.entries(rules)) {
		if (!isRuleWildcard(key)) continue;
		for (const id of expandRuleWildcard(key)) {
			apply(table, id, setting);
			record(id, key);
		}
	}
	for (const [key, setting] of Object.entries(rules)) {
		if (isRuleWildcard(key)) continue;
		apply(table, key, setting);
		record(key, key);
	}
}

/**
 * Resolve the cascade. `configs` are ordered root first, app last: each config's presets are applied,
 * then its `rules`, on top of everything before it. Overrides are collected in the same order and
 * applied per route by `get(id, route)`. The selected environment's `rules` (from gribble.yaml) are
 * applied last of all, after the route overrides too, so an environment can switch a rule off for
 * every route of that deployment.
 */
export function resolveRules(configs: RulesConfig[], opts: ResolveRulesOptions = {}): ResolvedRules {
	const table: Table = new Map();
	const sources = new Map<string, RuleSource>();
	for (const rule of RULES) {
		table.set(rule.id, { severity: "off", options: { ...(rule.defaultOptions ?? {}) } });
	}
	const ignore = new Set<string>();
	const overrides: RuleOverride[] = [];

	configs.forEach((config, level) => {
		for (const preset of config.extends ?? []) {
			if (!isPresetId(preset)) {
				throw new ConfigError(`unknown preset "${preset}". Available: ${PRESET_IDS.join(", ")}`, {
					file: "rules.yaml",
					path: "extends",
				});
			}
			applyBlock(table, PRESETS[preset], sources, () => ({ kind: "preset", preset, level }));
		}
		applyBlock(table, config.rules, sources, (key) => ({ kind: "rules", level, key }));
		for (const fp of config.ignore) ignore.add(fp);
		overrides.push(...config.overrides.map((o) => ({ routes: [...o.routes], rules: { ...o.rules } })));
	});

	const environment = opts.environment
		? { name: opts.environment.name, rules: { ...opts.environment.rules } }
		: undefined;
	if (environment) {
		applyBlock(table, environment.rules, sources, (key) => ({
			kind: "environment",
			environment: environment.name,
			key,
		}));
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
		if (environment) applyBlock(scoped, environment.rules);
		routeCache.set(route, scoped);
		return scoped;
	};

	return {
		ignore,
		overrides,
		environment,
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
		source(ruleId) {
			return sources.get(ruleId) ?? { kind: "default" };
		},
	};
}

/** Human-readable form of a {@link RuleSource}, e.g. `environments.preview.rules.seo/robots-noindex`. */
export function describeRuleSource(source: RuleSource): string {
	switch (source.kind) {
		case "default":
			return "registry default (off)";
		case "preset":
			return `preset ${source.preset} (rules.yaml, cascade level ${source.level + 1})`;
		case "rules":
			return `rules.yaml rules.${source.key} (cascade level ${source.level + 1})`;
		case "environment":
			return `environments.${source.environment}.rules.${source.key}`;
	}
}
