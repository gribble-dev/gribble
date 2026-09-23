/**
 * The optional review runtime. `gate` must keep working with `@earendil-works/pi-*` absent, so
 * the loader is the only place core reaches for them at runtime — and the one place that has to
 * turn "not installed" into something a user can act on.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	formatUndeclaredReviewRuntimeWarning,
	hasUndeclaredReviewRuntime,
	loadPiCodingAgent,
	REVIEW_RUNTIME_INSTALL_COMMAND,
	REVIEW_RUNTIME_PACKAGES,
	REVIEW_RUNTIME_UPGRADE_DOCS,
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

describe("a review runtime left over from an upgrade", () => {
	let repo: string;
	let installed: string;
	const resolveInRepo = () => installed;

	beforeEach(async () => {
		repo = await mkdtemp(join(tmpdir(), "gribble-stray-runtime-"));
		installed = join(repo, "node_modules", "@earendil-works", "pi-ai", "dist", "index.js");
		await mkdir(join(installed, ".."), { recursive: true });
		await writeFile(installed, "");
		await writeFile(join(repo, "package.json"), JSON.stringify({ devDependencies: { gribble: "0.4.0" } }));
	});
	afterEach(() => rm(repo, { recursive: true, force: true }));

	it("is reported when it resolves inside the repository and no package.json lists it", async () => {
		expect(await hasUndeclaredReviewRuntime(repo, repo, resolveInRepo)).toBe(true);
	});

	it("is not reported when the root or the audited app lists it", async () => {
		const app = join(repo, "apps", "web");
		await mkdir(app, { recursive: true });
		await writeFile(
			join(app, "package.json"),
			JSON.stringify({ devDependencies: { "@earendil-works/pi-ai": "0.85.1" } }),
		);
		expect(await hasUndeclaredReviewRuntime(repo, app, resolveInRepo)).toBe(false);
		await writeFile(
			join(repo, "package.json"),
			JSON.stringify({ devDependencies: { "@earendil-works/pi-ai": "0.85.1" } }),
		);
		expect(await hasUndeclaredReviewRuntime(repo, repo, resolveInRepo)).toBe(false);
	});

	it("is not reported when it is absent or installed outside the repository", async () => {
		expect(await hasUndeclaredReviewRuntime(repo, repo, () => undefined)).toBe(false);
		const elsewhere = join(
			tmpdir(),
			"global",
			"node_modules",
			"@earendil-works",
			"pi-ai",
			"dist",
			"index.js",
		);
		expect(await hasUndeclaredReviewRuntime(repo, repo, () => elsewhere)).toBe(false);
	});

	it("comes with a warning that names the package and the upgrade note", () => {
		const message = formatUndeclaredReviewRuntimeWarning();
		expect(message).toContain("@earendil-works/pi-ai");
		expect(message).toContain("gate mode does not need it");
		expect(message).toContain(REVIEW_RUNTIME_UPGRADE_DOCS);
	});
});
