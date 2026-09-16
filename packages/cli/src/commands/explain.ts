import {
	describeRuleSource,
	expandRuleWildcard,
	isRuleWildcard,
	type ProjectContext,
	type RuleMeta,
} from "@gribble/core";
import { copy } from "../copy.js";
import type { CliDeps } from "../deps.js";
import { EXIT } from "../errors.js";
import { findProjectDir } from "../project-dir.js";
import type { CommandContext } from "./context.js";

export interface ExplainCommandOptions {
	env?: string;
}

/** Load the project the current directory belongs to, or undefined when there is none above it. */
async function loadCurrentProject(
	deps: CliDeps,
	environment: string | undefined,
): Promise<ProjectContext | undefined> {
	const { cwd, env } = deps.context;
	const dir = await findProjectDir(cwd);
	if (!dir) return undefined;
	return deps.loadProject({ cwd, target: dir, environment, env });
}

/** Options with the same keys and values as the registry defaults need no line of their own. */
function stableOptions(options: Record<string, unknown>): string {
	const entries = Object.entries(options).sort(([a], [b]) => a.localeCompare(b));
	return JSON.stringify(Object.fromEntries(entries));
}

/** Route globs whose `overrides` block in the cascade sets this rule, in cascade order, deduplicated. */
function overridingRoutes(rules: ProjectContext["rules"], ruleId: string): string[] {
	const routes: string[] = [];
	for (const override of rules.overrides) {
		const touched = Object.keys(override.rules).some(
			(key) => key === ruleId || (isRuleWildcard(key) && expandRuleWildcard(key).some((id) => id === ruleId)),
		);
		if (touched) routes.push(...override.routes);
	}
	return [...new Set(routes)];
}

/**
 * What this project makes of the rule: the base severity, where it was set, the options when they
 * differ from the registry defaults, and the routes an `overrides` block re-settles it on. An
 * environment block is applied after every route override, so it leaves no routes to report.
 */
function effectiveLines(project: ProjectContext, rule: RuleMeta): string[] {
	const { severity, options } = project.rules.get(rule.id);
	const source = project.rules.source(rule.id);
	const lines = [""];
	const enabledButPlanned = severity !== "off" && !rule.implemented;
	lines.push(enabledButPlanned ? copy.explain.effectivePlanned(severity) : copy.explain.effective(severity));
	lines.push(copy.explain.effectiveSource(describeRuleSource(source)));
	if (severity !== "off" && stableOptions(options) !== stableOptions(rule.defaultOptions ?? {})) {
		lines.push(copy.explain.effectiveOptions(JSON.stringify(options)));
	}
	const routes = source.kind === "environment" ? [] : overridingRoutes(project.rules, rule.id);
	if (routes.length > 0) lines.push(copy.explain.effectiveRoutes(routes));
	return lines;
}

/**
 * `gribble explain <rule>`: prints the registry entry, and inside a project how that project
 * resolves the rule. Unknown rules print the hint and exit 2; outside a project nothing is added.
 */
export async function runExplain(
	ruleId: string,
	opts: ExplainCommandOptions,
	ctx: CommandContext,
): Promise<number> {
	const { deps, ui } = ctx;
	const rule = deps.getRule(ruleId);
	// Resolved before the first line so an unknown --env fails the way `audit --env` does.
	const project = rule ? await loadCurrentProject(deps, opts.env) : undefined;
	ui.line(deps.explainRule(ruleId));
	if (rule && project) for (const line of effectiveLines(project, rule)) ui.line(line);
	return rule ? EXIT.ok : EXIT.config;
}
