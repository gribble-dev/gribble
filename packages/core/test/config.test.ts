import { describe, expect, it } from "vitest";
import {
	ConfigError,
	gribbleConfigJsonSchema,
	parseGribbleConfig,
	parseRulesConfig,
	rulesConfigJsonSchema,
} from "../src/index.js";

const minimal = "target:\n  url: http://localhost:3000\n";

describe("parseGribbleConfig", () => {
	it("applies defaults", () => {
		const cfg = parseGribbleConfig(minimal, { env: {} });
		expect(cfg.target.routes).toBe("auto");
		expect(cfg.target.readyTimeoutMs).toBe(120000);
		expect(cfg.review).toEqual({ max_comments: 5, min_confidence: 0.7, vision: false, explore: true });
		expect(cfg.budget).toEqual({ max_steps: 200, max_tokens: 2000000 });
		expect(cfg.baseline).toEqual({ screenshots: "commit", update: "commit" });
		expect(cfg.viewports.mobile).toEqual({ width: 390, height: 844 });
		expect(cfg.output).toEqual({ dir: ".gribble/runs", keep: 10 });
		expect(cfg.reusePiAuth).toBe(false);
		expect(cfg.allowed_origins).toEqual([]);
	});

	it("interpolates placeholders from env", () => {
		const cfg = parseGribbleConfig("target:\n  url: $" + "{PREVIEW_URL}/app\n", {
			env: { PREVIEW_URL: "https://x.dev" },
		});
		expect(cfg.target.url).toBe("https://x.dev/app");
	});

	it("names the missing variable and the path", () => {
		expect(() => parseGribbleConfig(`target:\n  url: \${NOPE}\n`, { env: {} })).toThrowError(ConfigError);
		try {
			parseGribbleConfig(`target:\n  url: \${NOPE}\n`, { env: {} });
		} catch (err) {
			const e = err as ConfigError;
			expect(e.message).toContain("NOPE");
			expect(e.path).toBe("target.url");
		}
	});

	it("does not interpolate inactive environments", () => {
		const text = `${minimal}environments:\n  preview:\n    target:\n      url: \${PREVIEW_URL}\n`;
		expect(() => parseGribbleConfig(text, { env: {} })).not.toThrow();
	});

	it("deep-merges the selected environment", () => {
		const text = [
			"target:",
			"  url: http://localhost:3000",
			"  start: pnpm dev",
			"allowed_origins: [localhost]",
			"environments:",
			"  preview:",
			"    target:",
			`      url: \${PREVIEW_URL}`,
			'    allowed_origins: ["*.vercel.app"]',
			"    review: { max_comments: 3 }",
		].join("\n");
		const cfg = parseGribbleConfig(text, {
			env: { PREVIEW_URL: "https://pr-1.vercel.app" },
			environment: "preview",
		});
		expect(cfg.target.url).toBe("https://pr-1.vercel.app");
		expect(cfg.target.start).toBe("pnpm dev");
		expect(cfg.allowed_origins).toEqual(["*.vercel.app"]);
		expect(cfg.review.max_comments).toBe(3);
		expect(cfg.review.min_confidence).toBe(0.7);
	});

	it("rejects an unknown environment", () => {
		expect(() =>
			parseGribbleConfig(`${minimal}environments:\n  preview: {}\n`, { env: {}, environment: "prod" }),
		).toThrow(/unknown environment "prod".*preview/);
	});

	it("reports the path of invalid values", () => {
		try {
			parseGribbleConfig(`${minimal}review:\n  max_comments: many\n`, { env: {} });
			expect.unreachable();
		} catch (err) {
			const e = err as ConfigError;
			expect(e).toBeInstanceOf(ConfigError);
			expect(e.path).toBe("review.max_comments");
			expect(e.message).toMatch(/must be integer/);
		}
	});

	it("rejects unknown top-level keys and bad enums", () => {
		expect(() => parseGribbleConfig(`${minimal}reviews: {}\n`, { env: {} })).toThrow(
			/unknown property: reviews/,
		);
		expect(() => parseGribbleConfig(`${minimal}baseline: { update: yes }\n`, { env: {} })).toThrow(
			/baseline.update: must be one of: commit, pr, manual/,
		);
	});

	it("requires target.url", () => {
		expect(() => parseGribbleConfig("model: x/y\n", { env: {} })).toThrow(/target/);
	});

	it("rejects invalid YAML with a ConfigError", () => {
		expect(() => parseGribbleConfig("target: [", { env: {} })).toThrow(ConfigError);
	});

	it("validates auth profiles", () => {
		const text = [
			minimal,
			"auth:",
			"  profiles:",
			"    user: { type: flow, flow: flows/auth/login.md, env: { email: E, password: P } }",
			"    admin: { type: command, command: pnpm exec ./scripts/admin-session.ts }",
			"    cookie: { type: cookie, env: { value: GRIBBLE_COOKIE }, name: session }",
			"    header: { type: header, env: { value: GRIBBLE_TOKEN }, name: Authorization }",
		].join("\n");
		const cfg = parseGribbleConfig(text, { env: {} });
		expect(Object.keys(cfg.auth?.profiles ?? {})).toEqual(["user", "admin", "cookie", "header"]);
	});
});

describe("parseRulesConfig", () => {
	it("normalizes an empty file", () => {
		expect(parseRulesConfig("")).toEqual({ extends: [], ignore: [], rules: {}, overrides: [] });
	});

	it("treats empty sections as empty", () => {
		expect(parseRulesConfig("rules:\nignore:\noverrides:\n")).toEqual({
			extends: [],
			ignore: [],
			rules: {},
			overrides: [],
		});
	});

	it("accepts severities, tuples and wildcards", () => {
		const cfg = parseRulesConfig(
			[
				"extends: [gribble:recommended]",
				"rules:",
				"  seo/*: off",
				"  seo/title: [error, { max: 70 }]",
				"  links/broken: critical",
				"overrides:",
				'  - routes: ["/admin/**"]',
				"    rules: { perf/lcp: off }",
			].join("\n"),
		);
		expect(cfg.rules["seo/*"]).toBe("off");
		expect(cfg.rules["seo/title"]).toEqual(["error", { max: 70 }]);
		expect(cfg.overrides[0]?.routes).toEqual(["/admin/**"]);
	});

	it("rejects unknown rule ids with a clear message", () => {
		expect(() => parseRulesConfig("rules: { links/borken: error }")).toThrow(/unknown rule "links\/borken"/);
		expect(() => parseRulesConfig("overrides: [{ routes: ['/x'], rules: { nope/x: off } }]")).toThrow(
			/overrides.0.rules.nope\/x/,
		);
	});

	it("rejects bad severities and unknown options", () => {
		expect(() => parseRulesConfig("rules: { links/broken: fatal }")).toThrow(
			/rules.links\/broken: must be one of: off, info, warn, error, critical/,
		);
		expect(() => parseRulesConfig("rules: { links/redirect-chain: [warn, { maxx: 2 }] }")).toThrow(
			/unknown property: maxx/,
		);
		expect(() => parseRulesConfig("rules: { links/redirect-chain: [warn, { max: two }] }")).toThrow(
			/must be integer/,
		);
	});
});

describe("JSON schema export", () => {
	it("has $id and dialect", () => {
		const g = gribbleConfigJsonSchema() as Record<string, unknown>;
		const r = rulesConfigJsonSchema() as Record<string, unknown>;
		expect(g.$id).toBe("https://gribble.dev/schema/gribble.json");
		expect(r.$id).toBe("https://gribble.dev/schema/rules.json");
		expect(g.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
		expect(JSON.stringify(g)).not.toContain('"~kind"');
	});

	it("describes every property", () => {
		const missing: string[] = [];
		const walk = (node: unknown, path: string) => {
			if (!node || typeof node !== "object") return;
			const obj = node as Record<string, unknown>;
			if (obj.properties && typeof obj.properties === "object") {
				for (const [key, child] of Object.entries(obj.properties as Record<string, unknown>)) {
					const c = child as Record<string, unknown>;
					if (!c.description && !c.anyOf && !c.enum && !c.$ref) missing.push(`${path}.${key}`);
					walk(child, `${path}.${key}`);
				}
			}
			for (const key of ["items", "prefixItems", "anyOf", "patternProperties"]) {
				const v = obj[key];
				if (Array.isArray(v)) {
					v.forEach((c, i) => {
						walk(c, `${path}.${key}[${i}]`);
					});
				} else if (v && typeof v === "object") {
					for (const [k, c] of Object.entries(v)) walk(c, `${path}.${key}.${k}`);
				}
			}
		};
		walk(gribbleConfigJsonSchema(), "gribble");
		expect(missing).toEqual([]);
	});

	it("uses prefixItems for tuples", () => {
		const r = rulesConfigJsonSchema() as {
			properties: { rules: { properties: Record<string, { anyOf: unknown[] }> } };
		};
		const setting = r.properties.rules.properties["links/redirect-chain"]?.anyOf[1] as Record<
			string,
			unknown
		>;
		expect(setting.prefixItems).toBeDefined();
		expect(setting.items).toBe(false);
		expect(JSON.stringify(r)).not.toContain("additionalItems");
	});
});
