import { describe, expect, it } from "vitest";
import {
	describeRuleSource,
	explainRule,
	formatUnimplementedRulesWarning,
	getRule,
	PRESET_IDS,
	PRESETS,
	parseRulesConfig,
	RULE_IDS,
	RULES,
	renderRulesReference,
	resolveRules,
	unimplementedEnabledRules,
} from "../src/index.js";

/** Rules that shipped as `implemented: false` first and got their checkers later, with their severity untouched. */
const FORMERLY_PLANNED = [
	"a11y/focus-visible",
	"a11y/keyboard-reachable",
	"a11y/skip-link",
	"a11y/reduced-motion",
	"ui/spacing-from-tokens",
	"ui/empty-state",
	"html/deprecated-elements",
	"html/valid",
	"security/form-without-csrf",
	"i18n/mixed-language",
	"i18n/lang-mismatch",
] as const;

describe("registry", () => {
	it("has every rule id exactly once", () => {
		expect(RULES.map((r) => r.id)).toEqual([...RULE_IDS]);
		expect(new Set(RULE_IDS).size).toBe(RULE_IDS.length);
	});

	it("marks review rules as non-deterministic and links docs", () => {
		for (const rule of RULES) {
			expect(rule.deterministic).toBe(!rule.id.startsWith("review/"));
			expect(rule.docsUrl).toBe(`https://gribble.dev/rules/${rule.id}`);
			expect(rule.summary.length).toBeGreaterThan(5);
			expect(rule.fix.length).toBeGreaterThan(5);
			if (rule.optionsSchema) expect(rule.defaultOptions).toBeDefined();
		}
	});

	it("has a checker for every rule, the formerly planned set included", () => {
		expect(getRule("links/broken")?.implemented).toBe(true);
		expect(getRule("a11y/axe")?.implemented).toBe(true);
		expect(getRule("review/ux")?.implemented).toBe(true);
		for (const id of FORMERLY_PLANNED)
			expect({ id, implemented: getRule(id)?.implemented }).toEqual({ id, implemented: true });
		expect(RULES.filter((rule) => !rule.implemented).map((rule) => rule.id)).toEqual([]);
	});

	it("keeps the formerly planned rules off by default even though they run now", () => {
		// The decision was to land the checkers without changing anyone's defaults: `off` in
		// recommended and strict, and only the focused preset switches its own category on.
		for (const id of FORMERLY_PLANNED) {
			for (const preset of ["gribble:recommended", "gribble:strict", "gribble:seo"] as const) {
				const setting = PRESETS[preset][id];
				const severity = typeof setting === "string" ? setting : setting?.[0];
				expect({ preset, rule: id, severity }).toEqual({ preset, rule: id, severity: "off" });
			}
			const a11y = PRESETS["gribble:a11y"][id];
			const severity = typeof a11y === "string" ? a11y : a11y?.[0];
			expect({ rule: id, severity }).toEqual({ rule: id, severity: id.startsWith("a11y/") ? "warn" : "off" });
		}
		expect(PRESETS["gribble:recommended"]["html/valid"]).toEqual(["off", { ignore: [] }]);
	});
});

describe("presets", () => {
	it("recommended matches the brief", () => {
		const rec = PRESETS["gribble:recommended"];
		expect(rec["links/broken"]).toBe("error");
		expect(rec["links/broken-external"]).toEqual(["warn", { timeout: 10000, ignore: ["linkedin.com"] }]);
		expect(rec["network/page-error"]).toBe("critical");
		expect(rec["seo/twitter-card"]).toBe("off");
		expect(rec["a11y/axe"]).toEqual([
			"error",
			{ impact: ["critical", "serious"], tags: ["wcag2a", "wcag2aa"], disable: [] },
		]);
		expect(rec["perf/regression"]).toEqual(["warn", { score: -5, lcpMs: 500, cls: 0.05, weightKb: 300 }]);
		expect(rec["flows/replay"]).toBe("critical");
		expect(rec["review/guidelines"]).toBe("warn");
		// Implemented, but kept off so a default install does not change with the checkers.
		expect(rec["a11y/focus-visible"]).toBe("off");
		expect(rec["a11y/keyboard-reachable"]).toBe("off");
		expect(rec["html/deprecated-elements"]).toBe("off");
		expect(Object.keys(rec)).toHaveLength(RULE_IDS.length);
	});

	it("strict promotes warn to error in the listed categories only", () => {
		const strict = PRESETS["gribble:strict"];
		expect(strict["links/broken-external"]).toEqual(["error", { timeout: 10000, ignore: ["linkedin.com"] }]);
		expect(strict["seo/canonical"]).toBe("error");
		expect(strict["seo/twitter-card"]).toBe("off");
		expect(strict["perf/tbt"]).toEqual(["warn", { maxMs: 200 }]);
		expect(strict["review/ux"]).toBe("warn");
		// `off` stays `off`; strict promotes warn to error, it does not switch rules on.
		expect(strict["html/deprecated-elements"]).toBe("off");
		expect(strict["a11y/focus-visible"]).toBe("off");
		expect(strict["visual/regression"]).toEqual([
			"warn",
			{ threshold: 0.01, viewports: ["mobile", "desktop"] },
		]);
	});

	it("seo and a11y presets focus on one category", () => {
		const seo = PRESETS["gribble:seo"];
		expect(seo["seo/title"]).toEqual(["error", { min: 10, max: 60 }]);
		expect(seo["seo/twitter-card"]).toBe("warn");
		expect(seo["links/broken"]).toBe("off");
		const a11y = PRESETS["gribble:a11y"];
		expect(a11y["a11y/axe"]).toEqual([
			"error",
			{ impact: ["critical", "serious"], tags: ["wcag2a", "wcag2aa"], disable: [] },
		]);
		expect(a11y["a11y/touch-target"]).toEqual(["warn", { minPx: 44 }]);
		// Focusing on a category switches on the rules that are off in recommended, at warn,
		// the same way seo/twitter-card is warn in gribble:seo.
		expect(a11y["a11y/skip-link"]).toBe("warn");
		expect(a11y["a11y/focus-visible"]).toBe("warn");
		expect(a11y["a11y/keyboard-reachable"]).toBe("warn");
		expect(a11y["a11y/reduced-motion"]).toBe("warn");
		expect(a11y["seo/title"]).toBe("off");
		expect(a11y["html/deprecated-elements"]).toBe("off");
	});
});

describe("resolveRules", () => {
	it("expands presets and fills default options", () => {
		const rules = resolveRules([parseRulesConfig("extends: [gribble:recommended]")]);
		expect(rules.get("links/broken")).toEqual({ severity: "error", options: {} });
		expect(rules.get("links/redirect-chain")).toEqual({ severity: "warn", options: { max: 1 } });
		expect(rules.get("seo/twitter-card").severity).toBe("off");
		expect(rules.entries().some((e) => e.id === "seo/twitter-card")).toBe(false);
		expect(rules.entries({ includeOff: true })).toHaveLength(RULE_IDS.length);
	});

	it("is off for everything without presets or unknown ids", () => {
		const rules = resolveRules([]);
		expect(rules.get("links/broken").severity).toBe("off");
		expect(rules.get("nope/x")).toEqual({ severity: "off", options: {} });
		expect(rules.entries()).toEqual([]);
	});

	it("cascades child over parent and keeps options on bare severity", () => {
		const root = parseRulesConfig(
			"extends: [gribble:recommended]\nrules:\n  seo/title: [error, { max: 70 }]\nignore: [aaaa]",
		);
		const app = parseRulesConfig(
			"rules:\n  seo/title: warn\n  links/broken-external: [error, { timeout: 5 }]\nignore: [bbbb]",
		);
		const rules = resolveRules([root, app]);
		expect(rules.get("seo/title")).toEqual({ severity: "warn", options: { min: 10, max: 70 } });
		expect(rules.get("links/broken-external")).toEqual({
			severity: "error",
			options: { timeout: 5, ignore: ["linkedin.com"] },
		});
		expect([...rules.ignore]).toEqual(["aaaa", "bbbb"]);
	});

	it("applies wildcards before explicit ids regardless of order", () => {
		const rules = resolveRules([
			parseRulesConfig("extends: [gribble:recommended]\nrules:\n  seo/title: error\n  seo/*: off"),
		]);
		expect(rules.get("seo/title").severity).toBe("error");
		expect(rules.get("seo/canonical").severity).toBe("off");
	});

	it("applies route overrides with globs", () => {
		const rules = resolveRules([
			parseRulesConfig(
				[
					"extends: [gribble:recommended]",
					"overrides:",
					'  - routes: ["/admin/**", "/internal/**"]',
					"    rules: { seo/*: off, perf/lighthouse-performance: off }",
					'  - routes: ["/blog/**"]',
					"    rules: { seo/meta-description: error }",
				].join("\n"),
			),
		]);
		expect(rules.get("seo/title", "/pricing").severity).toBe("error");
		expect(rules.get("seo/title", "/admin").severity).toBe("off");
		expect(rules.get("seo/title", "/admin/users/[id]").severity).toBe("off");
		expect(rules.get("perf/lighthouse-performance", "/internal/x").severity).toBe("off");
		expect(rules.get("perf/lcp", "/admin/x").severity).toBe("error");
		expect(rules.get("seo/meta-description", "/blog/[slug]")).toEqual({
			severity: "error",
			options: { min: 50, max: 160 },
		});
		expect(rules.overrides).toHaveLength(2);
	});

	it("rejects unknown presets", () => {
		expect(() => resolveRules([parseRulesConfig("extends: [gribble:nope]")])).toThrow(/unknown preset/);
	});

	it("applies the selected environment's rules after presets, the cascade and route overrides", () => {
		const root = parseRulesConfig(
			[
				"extends: [gribble:recommended]",
				"rules:",
				"  seo/title: [error, { max: 70 }]",
				"overrides:",
				'  - routes: ["/blog/**"]',
				"    rules: { seo/robots-noindex: critical, seo/twitter-card: warn }",
			].join("\n"),
		);
		const app = parseRulesConfig("rules:\n  seo/robots-noindex: error\n");
		const rules = resolveRules([root, app], {
			environment: {
				name: "preview",
				rules: {
					"seo/robots-noindex": "off",
					"seo/title": "warn",
					"i18n/*": "off",
					"a11y/skip-link": "warn",
				},
			},
		});
		// Environment wins over the app-level rules.yaml and over a matching route override.
		expect(rules.get("seo/robots-noindex").severity).toBe("off");
		expect(rules.get("seo/robots-noindex", "/blog/[slug]").severity).toBe("off");
		// Route overrides the environment does not mention still apply.
		expect(rules.get("seo/twitter-card", "/blog/[slug]").severity).toBe("warn");
		expect(rules.get("seo/twitter-card", "/").severity).toBe("off");
		// A bare severity keeps the options configured so far; wildcards expand.
		expect(rules.get("seo/title")).toEqual({ severity: "warn", options: { min: 10, max: 70 } });
		expect(rules.get("i18n/untranslated-keys").severity).toBe("off");
		expect(rules.get("a11y/skip-link").severity).toBe("warn");
		expect(rules.entries().some((e) => e.id === "seo/robots-noindex")).toBe(false);
		expect(rules.environment).toEqual({
			name: "preview",
			rules: { "seo/robots-noindex": "off", "seo/title": "warn", "i18n/*": "off", "a11y/skip-link": "warn" },
		});
		// Without an environment the same cascade keeps the rule on.
		const plain = resolveRules([root, app]);
		expect(plain.get("seo/robots-noindex").severity).toBe("error");
		expect(plain.environment).toBeUndefined();
	});

	it("reports where each base setting came from", () => {
		const root = parseRulesConfig(
			"extends: [gribble:recommended]\nrules:\n  seo/*: off\n  seo/title: error\n",
		);
		const app = parseRulesConfig("rules:\n  links/broken: warn\n");
		const rules = resolveRules([root, app], {
			environment: { name: "preview", rules: { "seo/robots-noindex": "off", "i18n/*": "off" } },
		});
		expect(rules.source("links/empty-href")).toEqual({
			kind: "preset",
			preset: "gribble:recommended",
			level: 0,
		});
		expect(rules.source("seo/canonical")).toEqual({ kind: "rules", level: 0, key: "seo/*" });
		expect(rules.source("seo/title")).toEqual({ kind: "rules", level: 0, key: "seo/title" });
		expect(rules.source("links/broken")).toEqual({ kind: "rules", level: 1, key: "links/broken" });
		expect(rules.source("seo/robots-noindex")).toEqual({
			kind: "environment",
			environment: "preview",
			key: "seo/robots-noindex",
		});
		expect(rules.source("i18n/mixed-language")).toEqual({
			kind: "environment",
			environment: "preview",
			key: "i18n/*",
		});
		expect(resolveRules([]).source("links/broken")).toEqual({ kind: "default" });
		expect(describeRuleSource(rules.source("seo/robots-noindex"))).toBe(
			"environments.preview.rules.seo/robots-noindex",
		);
		expect(describeRuleSource(rules.source("links/broken"))).toBe(
			"rules.yaml rules.links/broken (cascade level 2)",
		);
		expect(describeRuleSource(rules.source("links/empty-href"))).toBe(
			"preset gribble:recommended (rules.yaml, cascade level 1)",
		);
		expect(describeRuleSource({ kind: "default" })).toBe("registry default (off)");
	});
});

describe("unimplemented rules", () => {
	// Every registered rule has a checker, so the helper is exercised against a stubbed registry in
	// which these five are still planned. The next planned rule will flow through the same code.
	const PLANNED = new Set([
		"a11y/keyboard-reachable",
		"a11y/skip-link",
		"html/deprecated-elements",
		"html/valid",
		"i18n/mixed-language",
		"i18n/lang-mismatch",
	]);
	const lookup = (id: string) => (getRule(id) ? { implemented: !PLANNED.has(id) } : undefined);

	it("lists enabled rules without a checker and formats one warning", () => {
		const rules = resolveRules([
			parseRulesConfig(
				[
					"extends: [gribble:recommended]",
					"rules:",
					"  a11y/keyboard-reachable: warn",
					"  a11y/skip-link: error",
					"  html/deprecated-elements: warn",
					"  html/valid: [error, { ignore: [] }]",
					"  i18n/mixed-language: warn",
					"  a11y/focus-visible: off",
				].join("\n"),
			),
		]);
		const ids = unimplementedEnabledRules(rules, lookup);
		expect(ids).toEqual([
			"a11y/keyboard-reachable",
			"a11y/skip-link",
			"html/deprecated-elements",
			"html/valid",
			"i18n/mixed-language",
		]);
		expect(ids).not.toContain("a11y/focus-visible");
		// Against the real registry the same configuration has nothing to warn about.
		expect(unimplementedEnabledRules(rules)).toEqual([]);
		expect(formatUnimplementedRulesWarning(ids)).toBe(
			"5 enabled rules have no checker yet and will not run: a11y/keyboard-reachable, a11y/skip-link, html/deprecated-elements, html/valid, i18n/mixed-language. Planned (accepted in rules.yaml, no checker yet); see gribble explain <rule>.",
		);
		expect(formatUnimplementedRulesWarning(["html/valid"])).toBe(
			"1 enabled rule has no checker yet and will not run: html/valid. Planned (accepted in rules.yaml, no checker yet); see gribble explain <rule>.",
		);
	});

	it("is silent for a default install", () => {
		// What `gribble init` writes: no rule of its own, so the audit must have nothing to warn about.
		for (const preset of PRESET_IDS) {
			const rules = resolveRules([parseRulesConfig(`extends: [${preset}]`)]);
			expect(unimplementedEnabledRules(rules)).toEqual([]);
			// gribble:a11y switches a11y/skip-link on, so a registry without its checker would warn.
			expect(unimplementedEnabledRules(rules, lookup)).toEqual(
				preset === "gribble:a11y" ? ["a11y/keyboard-reachable", "a11y/skip-link"] : [],
			);
		}
		expect(formatUnimplementedRulesWarning([])).toBeUndefined();
		expect(unimplementedEnabledRules(resolveRules([]), lookup)).toEqual([]);
	});

	it("is silent when every enabled rule has a checker", () => {
		const rules = resolveRules([
			parseRulesConfig(
				"extends: [gribble:recommended]\nrules:\n  a11y/skip-link: off\n  html/valid: off\n  i18n/*: off\n",
			),
		]);
		expect(unimplementedEnabledRules(rules, lookup)).toEqual([]);
	});

	it("counts route overrides and lets the environment have the last word", () => {
		const overridden = resolveRules([
			parseRulesConfig(
				'overrides:\n  - routes: ["/admin/**"]\n    rules: { html/valid: error, i18n/*: warn }\n',
			),
		]);
		expect(unimplementedEnabledRules(overridden, lookup)).toEqual([
			"html/valid",
			"i18n/mixed-language",
			"i18n/lang-mismatch",
		]);
		const env = resolveRules([parseRulesConfig("rules:\n  html/valid: error\n")], {
			environment: {
				name: "preview",
				rules: { "html/valid": "off", "a11y/*": "off", "a11y/skip-link": "warn" },
			},
		});
		expect(unimplementedEnabledRules(env, lookup)).toEqual(["a11y/skip-link"]);
		expect(unimplementedEnabledRules(env)).toEqual([]);
	});
});

describe("rendering", () => {
	it("renders the reference grouped by category with anchors", () => {
		const md = renderRulesReference();
		expect(md).toContain('<a id="links-broken"></a>');
		expect(md).toContain("### links/broken");
		expect(md).toContain("## SEO");
		expect(md).toContain('| `gribble:recommended` | `[warn, {"timeout":10000,"ignore":["linkedin.com"]}]` |');
		expect(md).toContain("| `timeout` | integer | `10000` |");
		expect(md).toContain("**Status:** implemented · **Kind:** deterministic");
		expect(md).not.toContain("planned (accepted in rules.yaml, no checker yet)");
		for (const id of RULE_IDS) expect(md).toContain(`### ${id}`);
	});

	it("marks a rule without a checker as planned", () => {
		const planned = { ...getRule("links/broken")!, implemented: false };
		const md = renderRulesReference([planned]);
		expect(md).toContain("### links/broken");
		expect(md).toContain(
			"**Status:** planned (accepted in rules.yaml, no checker yet) · **Kind:** deterministic",
		);
		expect(md).not.toContain("## SEO");
	});

	it("explains a rule and handles unknown ids", () => {
		const text = explainRule("links/redirect-chain");
		expect(text).toContain("links/redirect-chain");
		expect(text).toContain("max");
		expect(text).toContain("https://gribble.dev/rules/links/redirect-chain");
		expect(explainRule("seo/nope")).toContain('Unknown rule "seo/nope"');
		expect(explainRule("seo/nope")).toContain("seo/title");
	});
});
