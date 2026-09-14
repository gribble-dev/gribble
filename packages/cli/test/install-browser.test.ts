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
});
