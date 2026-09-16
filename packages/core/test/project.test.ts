import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
	ConfigError,
	detectRootGitignoreConflict,
	findGribbleDirs,
	gitignorePatternIgnoresGribbleDir,
	gribbleConfigSchema,
	loadProject,
	parseFlow,
	parseGribbleConfig,
	parseRulesConfig,
	renderInitTemplates,
	rulesConfigSchema,
} from "../src/index.js";
import { withTempDir } from "./helpers.js";

async function write(root: string, rel: string, text: string): Promise<void> {
	const path = join(root, rel);
	await mkdir(join(path, ".."), { recursive: true });
	await writeFile(path, text);
}

describe("renderInitTemplates", () => {
	const files = renderInitTemplates({
		url: "http://localhost:3000",
		start: "pnpm dev",
		model: "acme/model-x",
	});

	it("produces the documented file set", () => {
		expect(Object.keys(files).sort()).toEqual([
			".gitignore",
			"baseline/.gitkeep",
			"flows/README.md",
			"flows/smoke.md",
			"gribble.yaml",
			"guidelines.md",
			"rules.yaml",
		]);
		expect(files[".gitignore"]).toBe("runs/\nsessions/\ncache/\n");
		expect(
			files["gribble.yaml"]?.startsWith(
				"# yaml-language-server: $schema=https://gribble.dev/schema/gribble.json",
			),
		).toBe(true);
		expect(
			files["rules.yaml"]?.startsWith(
				"# yaml-language-server: $schema=https://gribble.dev/schema/rules.json",
			),
		).toBe(true);
		expect(files["gribble.yaml"]).toContain("model: acme/model-x");
		expect(files["gribble.yaml"]).toContain("start: pnpm dev");
	});

	it("parses back through the parsers and validates against the schemas", () => {
		const cfg = parseGribbleConfig(files["gribble.yaml"]!, { env: {} });
		expect(cfg.target.url).toBe("http://localhost:3000");
		expect(cfg.model).toBe("acme/model-x");
		expect(cfg.allowed_origins).toEqual(["localhost", "*.vercel.app"]);
		expect(Value.Check(gribbleConfigSchema, cfg)).toBe(true);
		const rules = parseRulesConfig(files["rules.yaml"]!);
		expect(rules).toEqual({ extends: ["gribble:recommended"], ignore: [], rules: {}, overrides: [] });
		expect(Value.Check(rulesConfigSchema, rules)).toBe(true);
		const smoke = parseFlow("flows/smoke.md", files["flows/smoke.md"]!);
		expect(smoke.name).toBe("smoke");
		expect(smoke.description).toMatch(/home page/);
	});

	it("comments out start when not given", () => {
		const noStart = renderInitTemplates({ url: "https://preview.example", model: "a/b" });
		expect(noStart["gribble.yaml"]).toContain("# start: pnpm dev");
		expect(parseGribbleConfig(noStart["gribble.yaml"]!, { env: {} }).target.start).toBeUndefined();
	});
});

describe("gitignore conflict", () => {
	it("detects patterns that swallow .gribble", () => {
		expect(gitignorePatternIgnoresGribbleDir(".gribble")).toBe(true);
		expect(gitignorePatternIgnoresGribbleDir(".gribble/")).toBe(true);
		expect(gitignorePatternIgnoresGribbleDir("/.gribble")).toBe(true);
		expect(gitignorePatternIgnoresGribbleDir("**/.gribble")).toBe(true);
		expect(gitignorePatternIgnoresGribbleDir(".gr*")).toBe(true);
		expect(gitignorePatternIgnoresGribbleDir(".gribble/runs/")).toBe(false);
		expect(gitignorePatternIgnoresGribbleDir("!.gribble")).toBe(false);
		expect(gitignorePatternIgnoresGribbleDir("# .gribble")).toBe(false);
		expect(gitignorePatternIgnoresGribbleDir("node_modules")).toBe(false);
	});

	it("reads the root .gitignore", async () => {
		await withTempDir(async (dir) => {
			expect(await detectRootGitignoreConflict(dir)).toBe(false);
			await write(dir, ".gitignore", "node_modules\n.gribble/runs/\n");
			expect(await detectRootGitignoreConflict(dir)).toBe(false);
			await write(dir, ".gitignore", "node_modules\n.gribble/\n");
			expect(await detectRootGitignoreConflict(dir)).toBe(true);
		});
	});
});

describe("loadProject", () => {
	it("cascades rules and guidelines from the repo root", async () => {
		await withTempDir(async (dir) => {
			await mkdir(join(dir, ".git"));
			await write(
				dir,
				".gribble/rules.yaml",
				"extends: [gribble:recommended]\nrules:\n  seo/title: [error, { max: 70 }]\n",
			);
			await write(dir, ".gribble/guidelines.md", "Root guideline.\n");
			await write(dir, "apps/web/.gribble/gribble.yaml", "target:\n  url: http://localhost:5173\n");
			await write(dir, "apps/web/.gribble/rules.yaml", "rules:\n  seo/title: warn\n  links/broken: off\n");
			await write(dir, "apps/web/.gribble/guidelines.md", "App guideline.\n");
			await write(dir, "apps/web/.gribble/flows/smoke.md", "Open it.");

			const project = await loadProject({ cwd: dir, target: "apps/web", env: {} });
			expect(project.repoRoot).toBe(dir);
			expect(project.targetName).toBe("apps/web");
			expect(project.gribbleDir).toBe(join(dir, "apps/web/.gribble"));
			expect(project.rules.get("seo/title")).toEqual({ severity: "warn", options: { min: 10, max: 70 } });
			expect(project.rules.get("links/broken").severity).toBe("off");
			expect(project.rules.get("links/empty-href").severity).toBe("warn");
			expect(project.guidelines).toBe(
				"<!-- guidelines: .gribble/guidelines.md -->\nRoot guideline.\n\n<!-- guidelines: apps/web/.gribble/guidelines.md -->\nApp guideline.",
			);
			expect(project.flows.map((f) => f.name)).toEqual(["smoke"]);
			expect(project.cascade).toEqual([join(dir, ".gribble"), join(dir, "apps/web/.gribble")]);

			const fromApp = await loadProject({ cwd: join(dir, "apps/web"), env: {} });
			expect(fromApp.targetName).toBe("apps/web");
			expect(fromApp.rules.get("seo/title").severity).toBe("warn");
		});
	});

	it("works for a single-app repo and reports missing config", async () => {
		await withTempDir(async (dir) => {
			await expect(loadProject({ cwd: dir, env: {} })).rejects.toThrow(ConfigError);
			await write(dir, ".gribble/gribble.yaml", "target:\n  url: http://localhost:3000\n");
			const project = await loadProject({ cwd: dir, env: {}, environment: undefined });
			expect(project.targetName).toBe("");
			expect(project.guidelines).toBe("");
			expect(project.rules.entries()).toEqual([]);
		});
	});

	it("passes environment through", async () => {
		await withTempDir(async (dir) => {
			await write(
				dir,
				".gribble/gribble.yaml",
				"target:\n  url: http://localhost:3000\nenvironments:\n  preview:\n    target: { url: https://p.dev }\n",
			);
			const project = await loadProject({ cwd: dir, env: {}, environment: "preview" });
			expect(project.config.target.url).toBe("https://p.dev");
			expect(project.environment).toBe("preview");
		});
	});
});

describe("loadProject environment rules", () => {
	it("applies environments.<name>.rules after the cascade only when that environment is selected", async () => {
		await withTempDir(async (dir) => {
			await mkdir(join(dir, ".git"));
			await write(dir, ".gribble/rules.yaml", "extends: [gribble:recommended]\n");
			await write(
				dir,
				"apps/web/.gribble/gribble.yaml",
				[
					"target:",
					"  url: http://localhost:5173",
					"environments:",
					"  preview:",
					"    target: { url: https://p.dev }",
					"    rules:",
					"      seo/robots-noindex: off",
					"      seo/title: warn",
				].join("\n"),
			);
			await write(
				dir,
				"apps/web/.gribble/rules.yaml",
				'rules:\n  seo/title: [error, { max: 70 }]\noverrides:\n  - routes: ["/blog/**"]\n    rules: { seo/robots-noindex: critical }\n',
			);

			const production = await loadProject({ cwd: dir, target: "apps/web", env: {} });
			expect(production.rules.get("seo/robots-noindex").severity).toBe("error");
			expect(production.rules.get("seo/robots-noindex", "/blog/[slug]").severity).toBe("critical");
			expect(production.rules.get("seo/title").severity).toBe("error");
			expect(production.rules.environment).toBeUndefined();

			const preview = await loadProject({ cwd: dir, target: "apps/web", env: {}, environment: "preview" });
			expect(preview.config.target.url).toBe("https://p.dev");
			expect(preview.rules.get("seo/robots-noindex").severity).toBe("off");
			expect(preview.rules.get("seo/robots-noindex", "/blog/[slug]").severity).toBe("off");
			expect(preview.rules.get("seo/title")).toEqual({ severity: "warn", options: { min: 10, max: 70 } });
			expect(preview.rules.source("seo/robots-noindex")).toEqual({
				kind: "environment",
				environment: "preview",
				key: "seo/robots-noindex",
			});
			expect(preview.rules.source("seo/title")).toEqual({
				kind: "environment",
				environment: "preview",
				key: "seo/title",
			});
			expect(preview.rules.get("links/broken").severity).toBe("error");
		});
	});
});

describe("findGribbleDirs", () => {
	it("finds app dirs with a target and skips shared-only roots and node_modules", async () => {
		await withTempDir(async (dir) => {
			await write(dir, ".gribble/rules.yaml", "rules: {}\n");
			await write(dir, "apps/web/.gribble/gribble.yaml", "target: { url: http://a }\n");
			await write(dir, "apps/admin/.gribble/gribble.yaml", "target: { url: http://b }\n");
			await write(dir, "node_modules/pkg/.gribble/gribble.yaml", "target: { url: http://c }\n");
			await write(dir, "packages/shared/.gribble/gribble.yaml", "# shared only\n");
			expect(await findGribbleDirs(dir)).toEqual([
				join(dir, "apps/admin/.gribble"),
				join(dir, "apps/web/.gribble"),
			]);
		});
	});
});
