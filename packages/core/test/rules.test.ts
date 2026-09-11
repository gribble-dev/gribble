import { describe, expect, it } from "vitest";
import {
	explainRule,
	getRule,
	PRESETS,
	parseRulesConfig,
	RULE_IDS,
	RULES,
	renderRulesReference,
	resolveRules,
} from "../src/index.js";

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

	it("implements the first-version set", () => {
		expect(getRule("links/broken")?.implemented).toBe(true);
		expect(getRule("a11y/axe")?.implemented).toBe(true);
		expect(getRule("a11y/color-contrast")?.implemented).toBe(false);
		expect(getRule("ui/overlap")?.implemented).toBe(false);
		expect(getRule("review/ux")?.implemented).toBe(true);
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
		expect(Object.keys(rec)).toHaveLength(RULE_IDS.length);
	});

	it("strict promotes warn to error in the listed categories only", () => {
		const strict = PRESETS["gribble:strict"];
		expect(strict["links/broken-external"]).toEqual(["error", { timeout: 10000, ignore: ["linkedin.com"] }]);
		expect(strict["seo/canonical"]).toBe("error");
		expect(strict["seo/twitter-card"]).toBe("off");
		expect(strict["perf/tbt"]).toEqual(["warn", { maxMs: 200 }]);
		expect(strict["review/ux"]).toBe("warn");
	});

	it("seo and a11y presets focus on one category", () => {
		const seo = PRESETS["gribble:seo"];
		expect(seo["seo/title"]).toEqual(["error", { min: 10, max: 60 }]);
		expect(seo["seo/twitter-card"]).toBe("warn");
		expect(seo["links/broken"]).toBe("off");
		const a11y = PRESETS["gribble:a11y"];
		expect(a11y["a11y/skip-link"]).toBe("warn");
		expect(a11y["seo/title"]).toBe("off");
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
});

describe("rendering", () => {
	it("renders the reference grouped by category with anchors", () => {
		const md = renderRulesReference();
		expect(md).toContain('<a id="links-broken"></a>');
		expect(md).toContain("### links/broken");
		expect(md).toContain("## SEO");
		expect(md).toContain('| `gribble:recommended` | `[warn, {"timeout":10000,"ignore":["linkedin.com"]}]` |');
		expect(md).toContain("| `timeout` | integer | `10000` |");
		expect(md).toContain("planned (accepted in rules.yaml, no checker yet)");
		for (const id of RULE_IDS) expect(md).toContain(`### ${id}`);
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
