import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEvent, BrowserSession, Flow, FlowReplay, ProjectContext } from "../src/index.js";
import { launchBrowser, replayFlow, resolveStepValue } from "../src/index.js";
import {
	type FixtureSite,
	hasChromium,
	makeProject,
	SKIP_BROWSER_REASON,
	startFixtureSite,
} from "./browser-helpers.js";

describe("resolveStepValue", () => {
	it("resolves env references and bare secret names", () => {
		const env = { PW: "hunter2" };
		expect(resolveStepValue("$" + "{PW}", undefined, env)).toBe("hunter2");
		expect(resolveStepValue("$PW", undefined, env)).toBe("hunter2");
		expect(resolveStepValue("PW", true, env)).toBe("hunter2");
		expect(resolveStepValue("plain", true, env)).toBe("plain");
		expect(resolveStepValue("literal", undefined, env)).toBe("literal");
		expect(() => resolveStepValue("$" + "{MISSING}", true, env)).toThrow(/MISSING/);
	});
});

describe.skipIf(!hasChromium())(`replayFlow (${SKIP_BROWSER_REASON})`, () => {
	let site: FixtureSite;
	let browser: BrowserSession;
	let dir: string;
	let project: ProjectContext;

	const flow = (name: string): Flow => ({ name, file: `/flows/${name}.md`, description: "Sign in." });
	const goodReplay: FlowReplay = {
		version: 1,
		name: "login",
		startUrl: "/login.html",
		steps: [
			{ action: "fill", selector: '[data-testid="email"]', value: "captain@example.com" },
			{ action: "fill", selector: '[data-testid="password"]', value: "GRIBBLE_TEST_PASSWORD", secret: true },
			{ action: "click", selector: '[data-testid="submit"]', description: "submit the form" },
			{ action: "expect_text", text: "Welcome back" },
			{ action: "expect_url", pattern: "/dashboard" },
			{ action: "expect_visible", selector: "#status" },
		],
	};

	beforeAll(async () => {
		site = await startFixtureSite();
		dir = await mkdtemp(join(tmpdir(), "gribble-replay-"));
		project = await makeProject({
			url: site.url,
			targetDir: dir,
			rulesYaml: "extends: [gribble:recommended]\nrules:\n  flows/max-duration: [warn, { seconds: 1 }]\n",
		});
		browser = await launchBrowser({ project, headless: true });
	}, 60_000);

	afterAll(async () => {
		await browser?.close();
		await site?.close();
		await rm(dir, { recursive: true, force: true });
	});

	it("replays a passing flow with secrets from the environment", async () => {
		const events: AuditEvent[] = [];
		const result = await replayFlow({
			flow: flow("login"),
			replay: goodReplay,
			browser,
			project,
			targetName: "",
			env: { GRIBBLE_TEST_PASSWORD: "hunter2" },
			onEvent: (e) => events.push(e),
		});
		expect(result).toMatchObject({ name: "login", ok: true, kind: "replay", steps: 6 });
		expect(result.findings.map((f) => f.rule)).not.toContain("flows/replay");
		expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["flow:start", "flow:end"]));
	}, 60_000);

	it("produces a flows/replay finding when a step fails", async () => {
		const result = await replayFlow({
			flow: flow("login"),
			replay: goodReplay,
			browser,
			project,
			targetName: "",
			env: { GRIBBLE_TEST_PASSWORD: "wrong" },
			stepTimeoutMs: 2_000,
		});
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/step 4: expect text "Welcome back" failed/);
		const finding = result.findings.find((f) => f.rule === "flows/replay");
		expect(finding).toMatchObject({ severity: "critical", route: "/login.html", subject: "step-4" });
		expect(finding?.viewport).toBeUndefined();
	}, 60_000);

	it("fails at the start when the start url is broken", async () => {
		const result = await replayFlow({
			flow: flow("broken"),
			replay: { ...goodReplay, name: "broken", startUrl: "/nope" },
			browser,
			project,
			targetName: "",
			env: {},
		});
		expect(result.ok).toBe(false);
		expect(result.findings[0]?.subject).toBe("start");
		expect(result.findings[0]?.message).toContain("HTTP 404");
	}, 60_000);

	it("warns and continues when the start url is broken but step 1 navigates (#34)", async () => {
		const events: AuditEvent[] = [];
		const result = await replayFlow({
			flow: flow("smoke"),
			replay: {
				version: 1,
				name: "smoke",
				// An older sidecar: an absolute leftover page that does not exist in this environment.
				startUrl: `${site.url}/cities/beijing/the-forbidden-city`,
				steps: [
					{ action: "navigate", url: "/" },
					{ action: "expect_text", text: "Welcome aboard" },
				],
			},
			browser,
			project,
			targetName: "",
			env: {},
			onEvent: (e) => events.push(e),
		});
		expect(result).toMatchObject({ ok: true, steps: 2 });
		expect(result.findings.map((f) => f.rule)).not.toContain("flows/replay");
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "log",
				level: "warn",
				message: expect.stringMatching(/flow smoke: start url .* failed: HTTP 404; continuing/),
			}),
		);
	}, 60_000);

	it("reports flows/max-duration when a flow is slow", async () => {
		const result = await replayFlow({
			flow: flow("slow"),
			replay: {
				version: 1,
				name: "slow",
				startUrl: "/",
				steps: [{ action: "wait_for", selector: "#does-not-exist", timeoutMs: 1_300 }],
			},
			browser,
			project,
			targetName: "",
			env: {},
		});
		// The wait fails (step failure), so only flows/replay fires; a passing slow flow is covered below.
		expect(result.ok).toBe(false);
		const slow = await replayFlow({
			flow: flow("slow-ok"),
			replay: {
				version: 1,
				name: "slow-ok",
				startUrl: "/",
				steps: [
					{ action: "navigate", url: "/about.html" },
					{ action: "navigate", url: "/holes.html" },
					{ action: "navigate", url: "/headings.html" },
					{ action: "navigate", url: "/login.html" },
					{ action: "navigate", url: "/wide.html" },
					{ action: "navigate", url: "/overlap.html" },
					{ action: "navigate", url: "/" },
				],
			},
			browser,
			project,
			targetName: "",
			env: {},
		});
		expect(slow.ok).toBe(true);
		if (slow.durationMs > 1_000) {
			expect(slow.findings.map((f) => f.rule)).toContain("flows/max-duration");
		}
	}, 60_000);
});
