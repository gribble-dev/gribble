import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseFrontmatterVersion, SKILL_VERSION, skillSource } from "../src/index.js";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
	version: string;
	files: string[];
};

function frontmatter(text: string): string {
	expect(text.startsWith("---\n")).toBe(true);
	const end = text.indexOf("\n---", 4);
	expect(end).toBeGreaterThan(0);
	return text.slice(4, end + 1);
}

describe("SKILL.md", () => {
	it("is readable from the package", async () => {
		const text = await skillSource();
		expect(text.length).toBeGreaterThan(500);
	});

	it("ships in the published files list", () => {
		expect(pkg.files).toContain("skills");
	});

	it("has valid Agent Skills frontmatter", async () => {
		const fm = frontmatter(await skillSource());
		const name = /^name:\s*(.+)$/m.exec(fm)?.[1]?.trim();
		expect(name).toBe("gribble");
		expect(name).toMatch(/^[a-z0-9][a-z0-9-]*$/);

		const description = /^description:\s*(.+)$/m.exec(fm)?.[1]?.trim();
		expect(description).toBeTruthy();
		expect(description!.length).toBeLessThanOrEqual(1024);
		for (const trigger of [
			"findings",
			".gribble/runs/latest.json",
			".gribble/flows/*.md",
			"rules.yaml",
			"gribble.yaml",
			"guidelines.md",
		]) {
			expect(description).toContain(trigger);
		}

		expect(fm).toMatch(/^metadata:\s*$/m);
	});

	it("keeps the version in sync with the package and SKILL_VERSION", async () => {
		expect(parseFrontmatterVersion(await skillSource())).toBe(SKILL_VERSION);
		expect(SKILL_VERSION).toBe(pkg.version);
	});

	it("has exactly the three documented top-level sections", async () => {
		const text = await skillSource();
		// Strip fenced code blocks so YAML comments are not mistaken for headings.
		const body = text.slice(text.indexOf("\n---", 4) + 4).replace(/^```[\s\S]*?^```/gm, "");
		const h1 = body.match(/^# .+$/gm) ?? [];
		expect(h1).toEqual(["# Gribble"]);
		const sections = (body.match(/^## .+$/gm) ?? []).map((line) => line.slice(3));
		expect(sections).toEqual(["Fix findings", "Write flows", "Change rules and guidelines"]);
	});

	it("documents the report shape, the verify command and the guardrails", async () => {
		const text = await skillSource();
		for (const needle of [
			".gribble/runs/latest.json",
			"fingerprint",
			"docsUrl",
			"gribble audit --mode gate",
			"npx gribble",
			"gribble explain <rule>",
			"gribble ignore <fingerprint>",
			".gribble/baseline/",
			"requires_auth",
			".replay.json",
		]) {
			expect(text).toContain(needle);
		}
	});

	it("stays English-only", async () => {
		expect(await skillSource()).not.toMatch(/[\u3400-\u9fff\u3040-\u30ff]/);
	});
});
