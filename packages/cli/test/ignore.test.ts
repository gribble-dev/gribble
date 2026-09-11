import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addIgnoredFingerprint } from "../src/commands/ignore.js";
import { run } from "../src/index.js";
import { testIo, withTempDir } from "./helpers.js";

const RULES = `# yaml-language-server: $schema=https://gribble.dev/schema/rules.json
extends:
  - gribble:recommended

ignore: []                          # finding fingerprints, added via \`gribble ignore <fp>\`

rules:
  # Tighten or relax anything from the preset.
  seo/meta-description: error       # keep this comment
  links/broken-external: [warn, { timeout: 5000 }]

# Per-route overrides:
# overrides:
#   - routes: ["/admin/**"]
`;

describe("gribble ignore", () => {
	it("appends to an empty flow list, keeping every comment", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "rules.yaml");
			await writeFile(path, RULES, "utf8");
			expect(await addIgnoredFingerprint(path, "9f2c1d4a7b3e0c58")).toBe("added");
			const out = await readFile(path, "utf8");
			expect(out).toContain(
				"ignore:                           # finding fingerprints, added via `gribble ignore <fp>`\n  - 9f2c1d4a7b3e0c58\n",
			);
			expect(out).toContain("links/broken-external: [warn, { timeout: 5000 }]");
			expect(out).toContain("# Tighten or relax anything from the preset.");
			expect(out).toContain("seo/meta-description: error       # keep this comment");
			expect(out).toContain('# Per-route overrides:\n# overrides:\n#   - routes: ["/admin/**"]');
			expect(out.startsWith("# yaml-language-server:")).toBe(true);

			expect(await addIgnoredFingerprint(path, "9f2c1d4a7b3e0c58")).toBe("already");
			expect(await addIgnoredFingerprint(path, "0123456789abcdef")).toBe("added");
			expect(await readFile(path, "utf8")).toContain("  - 9f2c1d4a7b3e0c58\n  - 0123456789abcdef\n");
		});
	});

	it("creates the key when rules.yaml has no ignore section", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "rules.yaml");
			await writeFile(path, "extends:\n  - gribble:recommended\n", "utf8");
			await addIgnoredFingerprint(path, "9f2c1d4a7b3e0c58");
			expect(await readFile(path, "utf8")).toBe(
				"extends:\n  - gribble:recommended\nignore:\n  - 9f2c1d4a7b3e0c58\n",
			);
		});
	});

	it("handles block lists, flow lists with items, and a bare key", async () => {
		const { spliceIgnore } = await import("../src/commands/ignore.js");
		expect(
			spliceIgnore(
				"ignore:\n  - aaaaaaaaaaaaaaaa   # why\n  - bbbbbbbbbbbbbbbb\nrules: {}\n",
				"cccccccccccccccc",
			)?.text,
		).toBe("ignore:\n  - aaaaaaaaaaaaaaaa   # why\n  - bbbbbbbbbbbbbbbb\n  - cccccccccccccccc\nrules: {}\n");
		expect(spliceIgnore("ignore:\n    - aaaaaaaaaaaaaaaa", "cccccccccccccccc")?.text).toBe(
			"ignore:\n    - aaaaaaaaaaaaaaaa\n    - cccccccccccccccc\n",
		);
		expect(spliceIgnore("ignore: [aaaaaaaaaaaaaaaa]  # c\nrules: {}\n", "cccccccccccccccc")?.text).toBe(
			"ignore: [aaaaaaaaaaaaaaaa, cccccccccccccccc]  # c\nrules: {}\n",
		);
		expect(spliceIgnore("ignore:   # none yet\nrules: {}\n", "cccccccccccccccc")?.text).toBe(
			"ignore:   # none yet\n  - cccccccccccccccc\nrules: {}\n",
		);
		expect(spliceIgnore("ignore:\n  - aaaaaaaaaaaaaaaa\n", "aaaaaaaaaaaaaaaa")?.status).toBe("already");
	});

	it("runs through the CLI and validates the fingerprint", async () => {
		await withTempDir(async (dir) => {
			await mkdir(join(dir, ".gribble"), { recursive: true });
			await writeFile(join(dir, ".gribble", "rules.yaml"), RULES, "utf8");
			const io = testIo({ cwd: dir });
			expect(await run(["ignore", "9F2C1D4A7B3E0C58"], { context: io.context })).toBe(0);
			expect(io.stdout.text).toContain("Added 9f2c1d4a7b3e0c58 to ignore in .gribble/rules.yaml.");

			const bad = testIo({ cwd: dir });
			expect(await run(["ignore", "not-a-fingerprint"], { context: bad.context })).toBe(2);
			expect(bad.stderr.text).toContain("not a fingerprint");

			const missing = testIo({ cwd: join(dir, "elsewhere") });
			expect(await run(["ignore", "9f2c1d4a7b3e0c58"], { context: missing.context })).toBe(2);
			expect(missing.stderr.text).toContain("No rules.yaml");
		});
	});
});
