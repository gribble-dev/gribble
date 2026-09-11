import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	AGENT_KINDS,
	AGENT_LABELS,
	detectAgents,
	installedSkillVersion,
	installSkill,
	SKILL_VERSION,
	skillSource,
	skillTargetPath,
} from "../src/index.js";

let repo: string;

beforeEach(async () => {
	repo = await mkdtemp(join(tmpdir(), "gribble-skills-"));
});

afterEach(async () => {
	await rm(repo, { recursive: true, force: true });
});

describe("detectAgents", () => {
	it("returns nothing for a bare repository", async () => {
		expect(await detectAgents(repo)).toEqual([]);
	});

	it("maps each marker to its agent kind", async () => {
		await mkdir(join(repo, ".claude"), { recursive: true });
		expect(await detectAgents(repo)).toEqual(["claude"]);

		await mkdir(join(repo, ".pi"), { recursive: true });
		await mkdir(join(repo, ".cursor"), { recursive: true });
		expect(await detectAgents(repo)).toEqual(["claude", "cursor", "pi"]);
	});

	it("treats AGENTS.md and .agents/ as the agents kind", async () => {
		await writeFile(join(repo, "AGENTS.md"), "# agents\n", "utf8");
		expect(await detectAgents(repo)).toEqual(["agents"]);

		const other = await mkdtemp(join(tmpdir(), "gribble-skills-"));
		await mkdir(join(other, ".agents"), { recursive: true });
		expect(await detectAgents(other)).toEqual(["agents"]);
		await rm(other, { recursive: true, force: true });
	});

	it("returns kinds in canonical order without duplicates", async () => {
		for (const dir of [".pi", ".cursor", ".claude", ".agents"]) {
			await mkdir(join(repo, dir), { recursive: true });
		}
		await writeFile(join(repo, "AGENTS.md"), "# agents\n", "utf8");
		expect(await detectAgents(repo)).toEqual(["agents", "claude", "cursor", "pi"]);
	});
});

describe("skillTargetPath", () => {
	it("maps agent kinds to their skill directories", () => {
		expect(skillTargetPath("/repo", "agents")).toBe("/repo/.agents/skills/gribble/SKILL.md");
		expect(skillTargetPath("/repo", "pi")).toBe("/repo/.agents/skills/gribble/SKILL.md");
		expect(skillTargetPath("/repo", "claude")).toBe("/repo/.claude/skills/gribble/SKILL.md");
		expect(skillTargetPath("/repo", "cursor")).toBe("/repo/.cursor/skills/gribble/SKILL.md");
	});

	it("has a label for every kind", () => {
		for (const kind of AGENT_KINDS) {
			expect(AGENT_LABELS[kind]).toBeTruthy();
		}
	});
});

describe("installSkill", () => {
	it("installs, then reports unchanged on a second run", async () => {
		const first = await installSkill(repo, ["claude"]);
		expect(first).toEqual([{ kind: "claude", path: skillTargetPath(repo, "claude"), status: "installed" }]);
		expect(await readFile(first[0]!.path, "utf8")).toBe(await skillSource());
		expect(await installedSkillVersion(first[0]!.path)).toBe(SKILL_VERSION);

		const second = await installSkill(repo, ["claude"]);
		expect(second[0]!.status).toBe("unchanged");
	});

	it("updates a file installed at another version", async () => {
		const path = skillTargetPath(repo, "cursor");
		await mkdir(join(repo, ".cursor/skills/gribble"), { recursive: true });
		await writeFile(path, '---\nname: gribble\nmetadata:\n  version: "0.0.1"\n---\n\nold\n', "utf8");

		const results = await installSkill(repo, ["cursor"]);
		expect(results[0]!.status).toBe("updated");
		expect(await installedSkillVersion(path)).toBe(SKILL_VERSION);
	});

	it("leaves a locally modified current-version file alone unless force is set", async () => {
		const path = skillTargetPath(repo, "claude");
		await installSkill(repo, ["claude"]);
		const modified = `${await skillSource()}\n<!-- local note -->\n`;
		await writeFile(path, modified, "utf8");

		expect((await installSkill(repo, ["claude"]))[0]!.status).toBe("unchanged");
		expect(await readFile(path, "utf8")).toBe(modified);

		expect((await installSkill(repo, ["claude"], { force: true }))[0]!.status).toBe("updated");
		expect(await readFile(path, "utf8")).toBe(await skillSource());
	});

	it("installs into several agents at once and shares the .agents path", async () => {
		const results = await installSkill(repo, ["agents", "pi", "claude"]);
		expect(results.map((r) => r.status)).toEqual(["installed", "unchanged", "installed"]);
		expect(results[0]!.path).toBe(results[1]!.path);
		expect(await readFile(skillTargetPath(repo, "claude"), "utf8")).toBe(await skillSource());
	});

	it("is a no-op for an empty kind list", async () => {
		expect(await installSkill(repo, [])).toEqual([]);
	});
});

describe("installedSkillVersion", () => {
	it("returns undefined for a missing file", async () => {
		expect(await installedSkillVersion(join(repo, "nope/SKILL.md"))).toBeUndefined();
	});

	it("returns undefined when there is no frontmatter", async () => {
		const path = join(repo, "plain.md");
		await writeFile(path, "# gribble\n\nversion: 9.9.9\n", "utf8");
		expect(await installedSkillVersion(path)).toBeUndefined();
	});

	it("reads metadata.version and a top-level version line", async () => {
		const meta = join(repo, "meta.md");
		await writeFile(meta, '---\nname: gribble\nmetadata:\n  version: "1.2.3"\n---\nbody\n', "utf8");
		expect(await installedSkillVersion(meta)).toBe("1.2.3");

		const top = join(repo, "top.md");
		await writeFile(top, "---\nname: gribble\nversion: 2.0.0\n---\nbody\n", "utf8");
		expect(await installedSkillVersion(top)).toBe("2.0.0");
	});

	it("ignores version keys nested under unrelated blocks", async () => {
		const path = join(repo, "nested.md");
		await writeFile(path, "---\nname: gribble\nother:\n  version: 9.9.9\n---\nbody\n", "utf8");
		expect(await installedSkillVersion(path)).toBeUndefined();
	});
});
