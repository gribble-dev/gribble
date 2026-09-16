import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/index.js";
import { testIo, withTempDir } from "./helpers.js";

const GRIBBLE_YAML = `target:
  url: http://localhost:3000
environments:
  preview:
    target:
      url: https://preview.example.com
    rules:
      seo/open-graph: off
      a11y/skip-link: warn
`;

const RULES_YAML = `extends:
  - gribble:recommended

rules:
  links/broken-external: [warn, { timeout: 5000 }]

overrides:
  - routes: ["/admin/**"]
    rules:
      seo/open-graph: off
`;

/** A project whose rules.yaml extends a preset, with a preview environment that switches rules. */
async function writeProject(dir: string): Promise<void> {
	await mkdir(join(dir, ".gribble"), { recursive: true });
	await writeFile(join(dir, ".gribble", "gribble.yaml"), GRIBBLE_YAML, "utf8");
	await writeFile(join(dir, ".gribble", "rules.yaml"), RULES_YAML, "utf8");
}

describe("gribble explain", () => {
	it("prints the registry entry alone outside a project, with or without --env", async () => {
		await withTempDir(async (dir) => {
			for (const argv of [
				["explain", "seo/open-graph"],
				["explain", "seo/open-graph", "--env", "preview"],
			]) {
				const io = testIo({ cwd: dir });
				expect(await run(argv, { context: io.context })).toBe(0);
				expect(io.stdout.text).toContain("Pages need Open Graph title, description and image.");
				expect(io.stdout.text).toContain("Presets: recommended=warn");
				expect(io.stdout.text).not.toContain("Effective:");
				expect(io.stdout.text).not.toContain("Source:");
			}
		});
	});

	it("appends the effective severity and its preset source inside a project", async () => {
		await withTempDir(async (dir) => {
			await writeProject(dir);
			const io = testIo({ cwd: dir });
			expect(await run(["explain", "seo/open-graph"], { context: io.context })).toBe(0);
			expect(io.stdout.text).toContain("\n  Effective: warn\n");
			expect(io.stdout.text).toContain("  Source: preset gribble:recommended (rules.yaml, cascade level 1)");
			expect(io.stdout.text).toContain("  Routes overriding it: /admin/**");
		});
	});

	it("finds the project from a subdirectory and reports options that differ from the defaults", async () => {
		await withTempDir(async (dir) => {
			await writeProject(dir);
			const nested = join(dir, "src", "pages");
			await mkdir(nested, { recursive: true });
			const io = testIo({ cwd: nested });
			expect(await run(["explain", "links/broken-external"], { context: io.context })).toBe(0);
			expect(io.stdout.text).toContain("\n  Effective: warn\n");
			expect(io.stdout.text).toContain("  Source: rules.yaml rules.links/broken-external (cascade level 1)");
			expect(io.stdout.text).toContain('  Effective options: {"timeout":5000,"ignore":["linkedin.com"]}');
		});
	});

	it("reports the environment as the source with --env, and leaves route overrides out", async () => {
		await withTempDir(async (dir) => {
			await writeProject(dir);
			const io = testIo({ cwd: dir });
			expect(await run(["explain", "seo/open-graph", "--env", "preview"], { context: io.context })).toBe(0);
			expect(io.stdout.text).toContain("\n  Effective: off\n");
			expect(io.stdout.text).toContain("  Source: environments.preview.rules.seo/open-graph");
			expect(io.stdout.text).not.toContain("Routes overriding it:");
		});
	});

	it("says an enabled rule without a checker will not run", async () => {
		await withTempDir(async (dir) => {
			await writeProject(dir);
			const io = testIo({ cwd: dir });
			expect(await run(["explain", "a11y/skip-link", "--env", "preview"], { context: io.context })).toBe(0);
			expect(io.stdout.text).toContain("Status: planned, no checker yet");
			expect(io.stdout.text).toContain("  Effective: warn (no checker yet, so it will not run)");
			expect(io.stdout.text).toContain("  Source: environments.preview.rules.a11y/skip-link");
		});
	});

	it("fails like `audit --env` on an unknown environment, printing nothing first", async () => {
		await withTempDir(async (dir) => {
			await writeProject(dir);
			const io = testIo({ cwd: dir });
			expect(await run(["explain", "seo/open-graph", "--env", "nope"], { context: io.context })).toBe(2);
			expect(io.stdout.text).toBe("");
			expect(io.stderr.text).toContain('unknown environment "nope". Available: preview');
		});
	});

	it("still exits 2 with the hint for an unknown rule inside a project", async () => {
		await withTempDir(async (dir) => {
			await writeProject(dir);
			const io = testIo({ cwd: dir });
			expect(await run(["explain", "seo/nope"], { context: io.context })).toBe(2);
			expect(io.stdout.text).toContain('Unknown rule "seo/nope".');
			expect(io.stdout.text).not.toContain("Effective:");
		});
	});
});
