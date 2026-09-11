import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/index.js";
import { fakeRuntime, scriptedPrompter, testIo, withTempDir } from "./helpers.js";

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

const EXPECTED_FILES = [
	"gribble.yaml",
	"rules.yaml",
	"guidelines.md",
	"flows/README.md",
	"flows/smoke.md",
	"baseline/.gitkeep",
	".gitignore",
];

describe("gribble init", () => {
	it("--yes with --model writes every template without touching the model runtime", async () => {
		await withTempDir(async (dir) => {
			await mkdir(join(dir, ".git"));
			await mkdir(join(dir, ".claude"));
			const io = testIo({ cwd: dir });
			const code = await run(
				["init", "--yes", "--model", "prov/model-x", "--url", "http://localhost:5173", "--start", "pnpm dev"],
				{
					context: io.context,
					createModelRuntime: async () => {
						throw new Error("must not be called when --model is given");
					},
				},
			);
			expect(code).toBe(0);
			for (const rel of EXPECTED_FILES) expect(await exists(join(dir, ".gribble", rel))).toBe(true);
			const yaml = await readFile(join(dir, ".gribble", "gribble.yaml"), "utf8");
			expect(yaml).toContain("url: http://localhost:5173");
			expect(yaml).toContain("start: pnpm dev");
			expect(yaml).toContain("model: prov/model-x");
			expect(await readFile(join(dir, ".gribble", ".gitignore"), "utf8")).toBe("runs/\nsessions/\ncache/\n");
			// skill installed into the detected agent only
			expect(await exists(join(dir, ".claude", "skills", "gribble", "SKILL.md"))).toBe(true);
			expect(await exists(join(dir, ".agents", "skills", "gribble", "SKILL.md"))).toBe(false);
			expect(io.stdout.text).toContain("Let's put some gribbles in your repo.");
			expect(io.stdout.text).toContain("The gribbles are aboard.");
		});
	});

	it("--yes without --model picks the first ranked model from a stubbed runtime", async () => {
		await withTempDir(async (dir) => {
			const io = testIo({ cwd: dir });
			const runtime = fakeRuntime({
				models: [
					{ provider: "other", id: "plain-model" },
					{ provider: "anthropic", id: "claude-sonnet-4-5" },
				],
				providers: [{ id: "anthropic", configured: true }],
			});
			const code = await run(["init", "--yes"], {
				context: io.context,
				createModelRuntime: async () => runtime,
			});
			expect(code).toBe(0);
			const yaml = await readFile(join(dir, ".gribble", "gribble.yaml"), "utf8");
			expect(yaml).toContain("model: anthropic/claude-sonnet-4-5");
			// no agent detected -> .agents/skills
			expect(await exists(join(dir, ".agents", "skills", "gribble", "SKILL.md"))).toBe(true);
		});
	});

	it("--yes with no reachable model leaves `model` commented and never prompts", async () => {
		await withTempDir(async (dir) => {
			const io = testIo({ cwd: dir });
			const code = await run(["init", "--yes"], {
				context: io.context,
				createModelRuntime: async () => fakeRuntime({}),
			});
			expect(code).toBe(0);
			const yaml = await readFile(join(dir, ".gribble", "gribble.yaml"), "utf8");
			expect(yaml).toMatch(/^# model: provider\/id/m);
			expect(yaml).not.toMatch(/^model:/m);
			expect(io.stdout.text).toContain("No model credentials found");
		});
	});

	it("never overwrites existing files unless --force, and warns about a root .gitignore conflict", async () => {
		await withTempDir(async (dir) => {
			await mkdir(join(dir, ".git"));
			await mkdir(join(dir, ".gribble"), { recursive: true });
			await writeFile(join(dir, ".gribble", "guidelines.md"), "# mine\n", "utf8");
			await writeFile(join(dir, ".gitignore"), "node_modules/\n.gribble/\n", "utf8");
			const io = testIo({ cwd: dir });
			expect(await run(["init", "--yes", "--model", "p/m"], { context: io.context })).toBe(0);
			expect(await readFile(join(dir, ".gribble", "guidelines.md"), "utf8")).toBe("# mine\n");
			expect(io.stdout.text).toContain("kept .gribble/guidelines.md");
			expect(io.stdout.text).toContain("Your root .gitignore ignores .gribble/ entirely.");

			expect(await run(["init", "--yes", "--model", "p/m", "--force"], { context: io.context })).toBe(0);
			expect(await readFile(join(dir, ".gribble", "guidelines.md"), "utf8")).not.toBe("# mine\n");
		});
	});

	it("walks through the prompts interactively, including the skill question", async () => {
		await withTempDir(async (dir) => {
			await mkdir(join(dir, ".cursor"));
			const io = testIo({ cwd: dir, isTTY: true });
			const runtime = fakeRuntime({
				models: [
					{ provider: "anthropic", id: "claude-sonnet-4-5" },
					{ provider: "openai", id: "gpt-5-mini" },
				],
				providers: [{ id: "anthropic", configured: true }],
			});
			const prompter = scriptedPrompter([
				{ text: "http://localhost:4321" },
				{ text: "" },
				{ select: "openai/gpt-5-mini" },
				{ confirm: true },
				{ multiselect: ["cursor", "agents"] },
			]);
			const code = await run(["init"], {
				context: io.context,
				createModelRuntime: async () => runtime,
				prompter: () => prompter,
			});
			expect(code).toBe(0);
			expect(prompter.log[0]).toBe("[intro] Let's put some gribbles in your repo.");
			expect(prompter.log).toContain("[confirm] Teach your coding agent to feed the gribbles?");
			const yaml = await readFile(join(dir, ".gribble", "gribble.yaml"), "utf8");
			expect(yaml).toContain("url: http://localhost:4321");
			expect(yaml).toContain("# start: pnpm dev");
			expect(yaml).toContain("model: openai/gpt-5-mini");
			expect(await exists(join(dir, ".cursor", "skills", "gribble", "SKILL.md"))).toBe(true);
			expect(await exists(join(dir, ".agents", "skills", "gribble", "SKILL.md"))).toBe(true);
		});
	});

	it("offers login inline when no credentials exist", async () => {
		await withTempDir(async (dir) => {
			const io = testIo({ cwd: dir, isTTY: true });
			let loggedIn = false;
			const runtime = fakeRuntime({ providers: [{ id: "anthropic", name: "Anthropic", oauth: true }] });
			runtime.getAvailable = async () =>
				loggedIn ? ([{ provider: "anthropic", id: "claude-sonnet-4-5" }] as never) : [];
			const prompter = scriptedPrompter([
				{ text: "http://localhost:3000" },
				{ text: "" },
				{ confirm: true }, // log in now?
				{ select: "Anthropic" },
				{ select: "api_key" },
				{ secret: "sk-test" },
				{ select: "anthropic/claude-sonnet-4-5" },
				{ confirm: false }, // skills
			]);
			const seen: Array<{ provider: string; apiKey?: string }> = [];
			const code = await run(["init"], {
				context: io.context,
				createModelRuntime: async () => runtime,
				prompter: () => prompter,
				loginProvider: async ({ provider, apiKey }) => {
					seen.push({ provider, apiKey });
					loggedIn = true;
				},
			});
			expect(code).toBe(0);
			expect(seen).toEqual([{ provider: "anthropic", apiKey: "sk-test" }]);
			expect(await readFile(join(dir, ".gribble", "gribble.yaml"), "utf8")).toContain(
				"model: anthropic/claude-sonnet-4-5",
			);
		});
	});

	it("--update-skills refreshes only installed skill files", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, ".claude", "skills", "gribble", "SKILL.md");
			await mkdir(join(dir, ".claude", "skills", "gribble"), { recursive: true });
			await writeFile(path, "---\nname: gribble\nversion: 0.0.1\n---\nSTALE-SKILL-BODY\n", "utf8");
			const io = testIo({ cwd: dir });
			expect(await run(["init", "--update-skills"], { context: io.context })).toBe(0);
			expect(await readFile(path, "utf8")).not.toContain("STALE-SKILL-BODY");
			expect(io.stdout.text).toContain("skill updated at .claude/skills/gribble/SKILL.md");
			expect(await exists(join(dir, ".gribble"))).toBe(false);

			const none = testIo({ cwd: join(dir, "empty") });
			await mkdir(join(dir, "empty"));
			expect(await run(["init", "--update-skills"], { context: none.context })).toBe(0);
			expect(none.stdout.text).toContain("No Gribble skill installed yet");
		});
	});
});
