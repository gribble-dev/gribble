import type { TSchema } from "typebox";
import type { RuleSetting } from "../config/types.js";
import { RULE_CATEGORIES, type RuleCategory } from "./ids.js";
import { PRESET_IDS } from "./presets.js";
import { getRule, type PresetName, RULES, type RuleMeta, rulesByCategory } from "./registry.js";

const CATEGORY_TITLES: Record<RuleCategory, string> = {
	links: "Links",
	network: "Network",
	seo: "SEO",
	a11y: "Accessibility",
	perf: "Performance",
	ui: "UI hard rules",
	visual: "Visual regression",
	structure: "Structure regression",
	html: "HTML",
	security: "Security",
	i18n: "Internationalization",
	flows: "Flows",
	review: "AI review",
};

const PRESET_COLUMNS: PresetName[] = ["recommended", "strict", "seo", "a11y"];

/** Anchor used in the generated reference: `links/broken` -> `links-broken`. */
export function ruleAnchor(id: string): string {
	return id.replace(/\//g, "-");
}

export function formatRuleSetting(setting: RuleSetting | undefined): string {
	if (setting === undefined) return "`off`";
	if (typeof setting === "string") return `\`${setting}\``;
	const [severity, options] = setting;
	if (Object.keys(options).length === 0) return `\`${severity}\``;
	return `\`[${severity}, ${JSON.stringify(options)}]\``;
}

function describeType(schema: TSchema): string {
	const s = schema as Record<string, unknown>;
	if (Array.isArray(s.anyOf)) {
		const parts = (s.anyOf as Array<Record<string, unknown>>).map((m) =>
			"const" in m ? JSON.stringify(m.const) : describeType(m as TSchema),
		);
		return parts.join(" \\| ");
	}
	if (s.type === "array") {
		const items = s.items as TSchema | undefined;
		return items ? `${describeType(items)}[]` : "array";
	}
	if (typeof s.type === "string") return s.type;
	return "any";
}

function optionRows(rule: RuleMeta): Array<{ name: string; type: string; def: string; description: string }> {
	if (!rule.optionsSchema) return [];
	const props = rule.optionsSchema.properties as Record<string, TSchema>;
	return Object.entries(props).map(([name, schema]) => {
		const s = schema as Record<string, unknown>;
		const def = rule.defaultOptions?.[name] ?? s.default;
		return {
			name,
			type: describeType(schema),
			def: def === undefined ? "" : `\`${JSON.stringify(def)}\``,
			description: typeof s.description === "string" ? s.description : "",
		};
	});
}

function escapeCell(text: string): string {
	return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderRule(rule: RuleMeta): string {
	const lines: string[] = [];
	lines.push(`<a id="${ruleAnchor(rule.id)}"></a>`);
	lines.push("");
	lines.push(`### ${rule.id}`);
	lines.push("");
	lines.push(rule.summary);
	lines.push("");
	lines.push(rule.description);
	lines.push("");
	const status = rule.implemented ? "implemented" : "planned (accepted in rules.yaml, no checker yet)";
	const kind = rule.deterministic ? "deterministic" : "AI review";
	lines.push(`**Status:** ${status} · **Kind:** ${kind}`);
	lines.push("");
	lines.push("| Preset | Setting |");
	lines.push("| --- | --- |");
	for (const preset of PRESET_COLUMNS) {
		lines.push(`| \`gribble:${preset}\` | ${formatRuleSetting(rule.presets[preset])} |`);
	}
	lines.push("");
	const options = optionRows(rule);
	if (options.length > 0) {
		lines.push("**Options**");
		lines.push("");
		lines.push("| Option | Type | Default | Description |");
		lines.push("| --- | --- | --- | --- |");
		for (const o of options) {
			lines.push(
				`| \`${o.name}\` | ${escapeCell(o.type)} | ${escapeCell(o.def)} | ${escapeCell(o.description)} |`,
			);
		}
		lines.push("");
	}
	lines.push(`**Fix:** ${rule.fix}`);
	lines.push("");
	if (rule.examples?.bad) {
		lines.push("Bad:");
		lines.push("");
		lines.push("```html");
		lines.push(rule.examples.bad);
		lines.push("```");
		lines.push("");
	}
	if (rule.examples?.good) {
		lines.push("Good:");
		lines.push("");
		lines.push("```html");
		lines.push(rule.examples.good);
		lines.push("```");
		lines.push("");
	}
	return lines.join("\n");
}

/** Markdown body for docs/configuration/rules-reference.md (without frontmatter). */
export function renderRulesReference(): string {
	const out: string[] = [];
	out.push("Every rule has an id of the form `category/name`. Set it in `.gribble/rules.yaml` to a severity");
	out.push(
		"(`off`, `info`, `warn`, `error`, `critical`) or to `[severity, { options }]`. `error` and `critical`",
	);
	out.push(
		"fail the gate; `warn` and `info` never block. Findings link here as `https://gribble.dev/rules/<id>`.",
	);
	out.push("");
	out.push(
		"Presets: " +
			PRESET_IDS.map((p) => `\`${p}\``).join(", ") +
			". `gribble init` extends `gribble:recommended`.",
	);
	out.push("");
	out.push("## Contents");
	out.push("");
	for (const category of RULE_CATEGORIES) {
		const rules = RULES.filter((r) => r.category === category);
		out.push(
			`- **${CATEGORY_TITLES[category]}**: ${rules.map((r) => `[${r.id}](#${ruleAnchor(r.id)})`).join(", ")}`,
		);
	}
	out.push("");
	for (const { category, rules } of rulesByCategory()) {
		out.push(`## ${CATEGORY_TITLES[category]}`);
		out.push("");
		for (const rule of rules) {
			out.push(renderRule(rule));
		}
	}
	return `${out.join("\n").trimEnd()}\n`;
}

function plainSetting(setting: RuleSetting | undefined): string {
	if (setting === undefined) return "off";
	if (typeof setting === "string") return setting;
	return Object.keys(setting[1]).length === 0 ? setting[0] : `${setting[0]} ${JSON.stringify(setting[1])}`;
}

/** Plain-text explanation for `gribble explain <rule>`. */
export function explainRule(id: string): string {
	const rule = getRule(id);
	if (!rule) {
		const category = id.split("/")[0] ?? "";
		const siblings = RULES.filter((r) => r.category === category).map((r) => r.id);
		const hint =
			siblings.length > 0
				? `Rules in "${category}": ${siblings.join(", ")}`
				: `Categories: ${RULE_CATEGORIES.join(", ")}`;
		return `Unknown rule "${id}".\n${hint}\nFull reference: https://gribble.dev/docs/configuration/rules-reference`;
	}
	const lines: string[] = [];
	lines.push(`${rule.id}  (${CATEGORY_TITLES[rule.category]})`);
	lines.push(`  ${rule.summary}`);
	lines.push("");
	lines.push(`  ${rule.description}`);
	lines.push("");
	const options = optionRows(rule);
	if (options.length > 0) {
		lines.push("  Options:");
		const width = Math.max(...options.map((o) => o.name.length));
		for (const o of options) {
			const def = o.def ? ` (default ${o.def.replace(/`/g, "")})` : "";
			lines.push(`    ${o.name.padEnd(width)}  ${o.type.replace(/\\\|/g, "|")}${def}  ${o.description}`);
		}
		lines.push("");
	}
	lines.push(`  Presets: ${PRESET_COLUMNS.map((p) => `${p}=${plainSetting(rule.presets[p])}`).join("  ")}`);
	lines.push(
		`  Status: ${rule.implemented ? "implemented" : "planned, no checker yet"}, ${rule.deterministic ? "deterministic" : "AI review"}`,
	);
	lines.push(`  Fix: ${rule.fix}`);
	if (rule.examples?.bad) lines.push(`  Bad:  ${rule.examples.bad}`);
	if (rule.examples?.good) lines.push(`  Good: ${rule.examples.good}`);
	lines.push(`  Docs: ${rule.docsUrl}`);
	return lines.join("\n");
}
