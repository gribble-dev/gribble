import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePlaywrightCli } from "../src/install-browser.js";

describe("resolvePlaywrightCli", () => {
	it("finds cli.js next to the resolved package.json (cli.js is not in Playwright's exports map)", () => {
		const pkg = path.join("/repo", "node_modules", "playwright", "package.json");
		const cli = resolvePlaywrightCli(
			() => pkg,
			(file) => file === path.join("/repo", "node_modules", "playwright", "cli.js"),
		);
		expect(cli).toBe(path.join("/repo", "node_modules", "playwright", "cli.js"));
	});

	it("returns undefined when playwright is not installed", () => {
		expect(
			resolvePlaywrightCli(() => {
				throw Object.assign(new Error("not found"), { code: "MODULE_NOT_FOUND" });
			}),
		).toBeUndefined();
	});

	it("returns undefined when the package resolves but has no cli.js", () => {
		expect(
			resolvePlaywrightCli(
				() => "/repo/node_modules/playwright/package.json",
				() => false,
			),
		).toBeUndefined();
	});

	it("resolves the real Playwright CLI in this repository", () => {
		const cli = resolvePlaywrightCli();
		expect(cli).toBeDefined();
		expect(cli?.endsWith(`${path.sep}cli.js`)).toBe(true);
	});

	it("resolves to a script node can run as the playwright CLI", () => {
		const cli = resolvePlaywrightCli() as string;
		const { version } = createRequire(import.meta.url)("playwright/package.json") as { version: string };
		const out = execFileSync(process.execPath, [cli, "--version"], { encoding: "utf8" });
		expect(out.trim()).toContain(version);
	});
});
