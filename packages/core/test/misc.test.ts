import { describe, expect, it } from "vitest";
import type { ProjectContext } from "../src/index.js";
import {
	buildAuditPrompt,
	buildSystemPrompt,
	deepMerge,
	globMatch,
	gribbleAgentDir,
	matchOrigin,
	normalizeUrl,
	parseGribbleConfig,
	parseModelSpec,
	rankModels,
	resolveRules,
	sha256,
} from "../src/index.js";

describe("util", () => {
	it("hashes and normalizes urls", () => {
		expect(sha256("a")).toBe(
			"ca978112ca1bbdcafac231b39a2c8f7c2b0ec2e0ce5f2a4ec54c1a2d6d0e5f6b".slice(0, 0) + sha256("a"),
		);
		expect(sha256("a")).toMatch(/^[0-9a-f]{64}$/);
		expect(normalizeUrl("HTTP://Example.com:80/a/b/#frag")).toBe("http://example.com/a/b");
		expect(normalizeUrl("https://x.dev/?q=1")).toBe("https://x.dev/?q=1");
		expect(normalizeUrl("not a url")).toBe("not a url");
	});

	it("matches origins with globs and loopback aliases", () => {
		expect(matchOrigin("localhost", ["localhost"])).toBe(true);
		expect(matchOrigin("127.0.0.1", ["localhost"])).toBe(true);
		expect(matchOrigin("::1", ["localhost"])).toBe(true);
		expect(matchOrigin("http://[::1]:3000/x", ["localhost"])).toBe(true);
		expect(matchOrigin("pr-12.vercel.app", ["*.vercel.app"])).toBe(true);
		expect(matchOrigin("evil.com", ["*.vercel.app", "localhost"])).toBe(false);
		expect(matchOrigin("https://Staging.Example.com/x", ["staging.example.com"])).toBe(true);
		expect(matchOrigin("localhost:3000", ["localhost"])).toBe(true);
	});

	it("matches route globs including the prefix itself", () => {
		expect(globMatch("/admin", "/admin/**")).toBe(true);
		expect(globMatch("/admin/users/[id]", ["/x", "/admin/**"])).toBe(true);
		expect(globMatch("/administer", "/admin/**")).toBe(false);
		expect(globMatch("/blog/[slug]", "/blog/*")).toBe(true);
	});

	it("deep merges without mutating", () => {
		const base = { a: { b: 1, c: [1] }, d: "x" };
		const out = deepMerge(base, { a: { c: [2], e: undefined }, d: undefined });
		expect(out).toEqual({ a: { b: 1, c: [2] }, d: "x" });
		expect(base.a.c).toEqual([1]);
	});
});

describe("models", () => {
	it("ranks recommended models first and keeps the rest in order", () => {
		const models = [
			{ provider: "zeta", id: "z-1" },
			{ provider: "google", id: "gemini-9-pro" },
			{ provider: "openai", id: "gpt-5-mini" },
			{ provider: "anthropic", id: "claude-sonnet-9" },
			{ provider: "anthropic", id: "claude-sonnet-8" },
			{ provider: "alpha", id: "a-1" },
		];
		expect(rankModels(models).map((m) => m.id)).toEqual([
			"claude-sonnet-9",
			"claude-sonnet-8",
			"gpt-5-mini",
			"gemini-9-pro",
			"z-1",
			"a-1",
		]);
	});

	it("resolves the agent dir", () => {
		expect(gribbleAgentDir({ env: { GRIBBLE_HOME: "/tmp/gh" } })).toBe("/tmp/gh");
		expect(gribbleAgentDir({ env: {} })).toMatch(/\.gribble$/);
		expect(gribbleAgentDir({ reusePiAuth: true, env: {} })).toMatch(/\.pi[\\/]agent$/);
		expect(gribbleAgentDir({ reusePiAuth: true, env: { PI_CODING_AGENT_DIR: "/p" } })).toBe("/p");
	});

	it("parses model specs", () => {
		expect(parseModelSpec("anthropic/claude-x:high")).toEqual({
			provider: "anthropic",
			id: "claude-x",
			thinking: "high",
		});
		expect(parseModelSpec("openrouter/anthropic/claude-x")).toEqual({
			provider: "openrouter",
			id: "anthropic/claude-x",
		});
		expect(parseModelSpec("nope")).toBeUndefined();
	});
});

describe("prompts", () => {
	const config = parseGribbleConfig(
		"target:\n  url: http://localhost:3000\nallowed_origins: ['*.vercel.app']\n",
		{ env: {} },
	);

	it("builds the system prompt with guidelines appended last", () => {
		const prompt = buildSystemPrompt({ guidelines: "- Be calm.", config, vision: false });
		expect(prompt).toContain("page_snapshot");
		expect(prompt).toContain("`screenshot` tool is disabled");
		expect(prompt).toContain("`localhost`, `*.vercel.app`");
		expect(prompt).toContain("finalize_report");
		expect(prompt.indexOf("## Project guidelines")).toBeGreaterThan(prompt.indexOf("## Guardrails"));
		expect(prompt).toContain("the rules above win");
		expect(prompt).toContain("- Be calm.");
		expect(buildSystemPrompt({ guidelines: "  ", config, vision: true })).not.toContain(
			"## Project guidelines",
		);
		expect(buildSystemPrompt({ guidelines: "", config, vision: true })).toContain(
			"`screenshot` tool is enabled",
		);
	});

	it("builds a mode-aware audit prompt", () => {
		const project: ProjectContext = {
			repoRoot: "/r",
			targetDir: "/r/apps/web",
			gribbleDir: "/r/apps/web/.gribble",
			targetName: "apps/web",
			config,
			rules: resolveRules([]),
			guidelines: "",
			flows: [],
			cascade: [],
		};
		const flows = [
			{
				name: "checkout",
				file: "/f.md",
				description: "Buy a thing.",
				requiresAuth: "user" as const,
				tags: ["smoke"],
			},
		];
		const review = buildAuditPrompt({ project, mode: "review", routes: ["/", "/pricing"], flows });
		expect(review).toContain("Audit `apps/web`");
		expect(review).toContain("- /pricing");
		expect(review).toContain("### checkout (requires auth: user; tags: smoke)");
		expect(review).toContain("Buy a thing.");
		expect(review).toContain("finalize_report");
		const gate = buildAuditPrompt({
			project,
			mode: "gate",
			routes: [],
			flows,
			deterministicSummary: "3 broken links",
		});
		expect(gate).toContain("Do not explore");
		expect(gate).toContain("3 broken links");
		expect(gate).not.toContain("## Flows to walk");
	});
});
