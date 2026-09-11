import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadFlows, parseFlow, parseFlowReplay } from "../src/index.js";
import { withTempDir } from "./helpers.js";

describe("parseFlow", () => {
	it("parses frontmatter and maps requires_auth", () => {
		const flow = parseFlow(
			"/x/flows/checkout.md",
			"---\nname: buy\nrequires_auth: user\nenv: [preview]\ntags: [smoke]\n---\nDo the thing.\n",
		);
		expect(flow).toEqual({
			name: "buy",
			file: "/x/flows/checkout.md",
			description: "Do the thing.",
			requiresAuth: "user",
			env: ["preview"],
			tags: ["smoke"],
		});
	});

	it("defaults the name to the file name and tolerates no frontmatter", () => {
		expect(parseFlow("/x/flows/auth/login.md", "Log in.").name).toBe("login");
		expect(parseFlow("/x/flows/a.md", "---\n---\nBody").description).toBe("Body");
		expect(parseFlow("/x/flows/a.md", "---\nrequires_auth: true\n---\nBody").requiresAuth).toBe(true);
		expect(parseFlow("/x/flows/a.md", "---\nrequires_auth: false\n---\nBody").requiresAuth).toBeUndefined();
	});

	it("rejects bad frontmatter", () => {
		expect(() => parseFlow("/x/a.md", "---\nenv: nope\n---\n")).toThrow(ConfigError);
		expect(() => parseFlow("/x/a.md", "---\n- list\n---\n")).toThrow(/mapping/);
	});
});

describe("parseFlowReplay", () => {
	it("validates steps", () => {
		const ok = parseFlowReplay(
			"/x/a.replay.json",
			JSON.stringify({
				version: 1,
				name: "a",
				startUrl: "/",
				steps: [
					{ action: "click", selector: "#go" },
					{ action: "expect_url", pattern: "/done" },
				],
			}),
		);
		expect(ok.steps).toHaveLength(2);
		expect(() =>
			parseFlowReplay(
				"/x/a.replay.json",
				JSON.stringify({ version: 1, name: "a", startUrl: "/", steps: [{ action: "jump" }] }),
			),
		).toThrow(ConfigError);
		expect(() => parseFlowReplay("/x/a.replay.json", "{")).toThrow(/invalid JSON/);
	});
});

describe("loadFlows", () => {
	it("reads flows recursively, skips README, attaches sidecars", async () => {
		await withTempDir(async (dir) => {
			await mkdir(join(dir, "flows", "auth"), { recursive: true });
			await writeFile(join(dir, "flows", "README.md"), "# not a flow");
			await writeFile(join(dir, "flows", "smoke.md"), "---\ntags: [smoke]\n---\nOpen the home page.");
			await writeFile(join(dir, "flows", "auth", "login.md"), "Log in.");
			await writeFile(
				join(dir, "flows", "smoke.replay.json"),
				JSON.stringify({
					version: 1,
					name: "smoke",
					startUrl: "/",
					steps: [{ action: "navigate", url: "/" }],
				}),
			);
			const flows = await loadFlows(dir);
			expect(flows.map((f) => f.name)).toEqual(["login", "smoke"]);
			expect(flows[1]?.replay?.steps).toHaveLength(1);
			expect(flows[0]?.replay).toBeUndefined();
		});
	});

	it("returns [] without a flows directory", async () => {
		await withTempDir(async (dir) => expect(await loadFlows(dir)).toEqual([]));
	});
});
