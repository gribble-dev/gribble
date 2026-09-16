/**
 * The optional review runtime. `gate` must keep working with `@earendil-works/pi-*` absent, so
 * the loader is the only place core reaches for them at runtime — and the one place that has to
 * turn "not installed" into something a user can act on.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
	loadPiCodingAgent,
	REVIEW_RUNTIME_INSTALL_COMMAND,
	REVIEW_RUNTIME_PACKAGES,
	ReviewRuntimeMissingError,
} from "../src/index.js";

describe("the review runtime peer dependencies", () => {
	it("are declared optional in the manifest, and only there", async () => {
		const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
		const peers = ["@earendil-works/pi-agent-core", ...REVIEW_RUNTIME_PACKAGES];
		for (const name of peers) {
			expect(manifest.dependencies?.[name], `${name} must not be a hard dependency`).toBeUndefined();
			expect(manifest.peerDependencies?.[name]).toBeDefined();
			expect(manifest.peerDependenciesMeta?.[name]).toEqual({ optional: true });
		}
	});

	it("are named, with the pinned version, in one install command", () => {
		expect(REVIEW_RUNTIME_PACKAGES).toEqual(["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"]);
		expect(REVIEW_RUNTIME_INSTALL_COMMAND).toMatch(/^npm install /);
		for (const name of REVIEW_RUNTIME_PACKAGES) expect(REVIEW_RUNTIME_INSTALL_COMMAND).toContain(name);
	});

	it("produce an error that says what to install and that gate needs none of it", () => {
		const err = new ReviewRuntimeMissingError(new Error("Cannot find package"));
		expect(err.name).toBe("ReviewRuntimeMissingError");
		expect(err.message).toContain(REVIEW_RUNTIME_INSTALL_COMMAND);
		expect(err.message).toContain("--mode gate");
		expect(err.packages).toEqual([...REVIEW_RUNTIME_PACKAGES]);
	});

	it("load once and resolve to the real module when installed", async () => {
		const first = loadPiCodingAgent();
		expect(loadPiCodingAgent()).toBe(first);
		expect(typeof (await first).SettingsManager.create).toBe("function");
	});
});
