import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
	type AuditEvent,
	BROWSER_TOOLS,
	browserPack,
	FLOW_TOOLS,
	flowReplaySchema,
	flowSlug,
	flowsPack,
	relativeToTarget,
	replaySelectorCandidates,
} from "../src/index.js";
import {
	element,
	fakeBrowser,
	fakePage,
	fakePi,
	fakeProject,
	fakeState,
	snapshot,
	withTempDir,
} from "./agent-helpers.js";

describe("flow recording", () => {
	it("records browser actions between flow_start and flow_end into a valid replay sidecar", async () => {
		await withTempDir(async (dir) => {
			const events: AuditEvent[] = [];
			const browser = fakeBrowser();
			const state = fakeState({
				project: fakeProject({ dir }),
				browser,
				events,
				env: { GRIBBLE_USER_PASSWORD: "hunter2-secret" },
			});
			const h = fakePi();
			await h.load(browserPack(state));
			await h.load(flowsPack(state));

			await h.call(FLOW_TOOLS.flowStart, { name: "login" });
			expect(events.at(-1)).toEqual({ type: "flow:start", flow: "login" });
			await h.call(BROWSER_TOOLS.navigate, { url: "/login" });
			const page = browser.pages.desktop!;
			page.nextSnapshot = snapshot({
				url: "http://localhost:3000/login",
				interactive: [
					element({ ref: "e1", role: "textbox", name: "Email", tag: "input", testId: "email" }),
					element({ ref: "e2", role: "textbox", name: "Password", tag: "input", id: "pw" }),
					element({ ref: "e3", role: "button", name: "Sign in" }),
				],
			});
			await h.call(BROWSER_TOOLS.pageSnapshot, {});
			await h.call(BROWSER_TOOLS.fill, { target: "ref=e1", value: "ada@example.com" });
			await h.call(BROWSER_TOOLS.fill, { target: "ref=e2", secret_env: "GRIBBLE_USER_PASSWORD" });
			await h.call(BROWSER_TOOLS.click, { target: "ref=e3", description: "submit" });
			await h.call(BROWSER_TOOLS.press, { key: "Enter" });
			await h.call(BROWSER_TOOLS.waitFor, { url: "/dashboard*" });
			const end = await h.call<{ ok: boolean; steps: number; replay?: string }>(FLOW_TOOLS.flowEnd, {
				name: "login",
				ok: true,
			});

			expect(end.details.ok).toBe(true);
			expect(end.details.steps).toBe(6);
			expect(page.calls.find((c) => c.method === "fill" && c.args[0] === "ref=e2")?.args[1]).toBe(
				"hunter2-secret",
			);
			const sidecar = join(dir, ".gribble", "flows", "login.replay.json");
			expect(end.details.replay).toBe(sidecar);
			expect(state.replaysWritten).toEqual([sidecar]);
			const replay = JSON.parse(await readFile(sidecar, "utf8"));
			expect(Value.Check(flowReplaySchema, replay)).toBe(true);
			// The flow navigates first, so it starts at the target root, not wherever the agent was.
			expect(replay.startUrl).toBe("/");
			expect(replay.steps).toEqual([
				{ action: "navigate", url: "/login" },
				{ action: "fill", selector: '[data-testid="email"]', value: "ada@example.com" },
				{ action: "fill", selector: "#pw", value: "$" + "{GRIBBLE_USER_PASSWORD}", secret: true },
				{ action: "click", selector: 'role=button[name="Sign in"]', description: "submit" },
				{ action: "press", key: "Enter" },
				{ action: "wait_for", url: "/dashboard*" },
			]);
			expect(state.flowResults).toEqual([
				{ name: "login", ok: true, kind: "ai", durationMs: expect.any(Number), steps: 6 },
			]);
			expect(events.at(-1)).toMatchObject({ type: "flow:end", flow: "login", ok: true });
		});
	});

	it("does not write a replay for failed flows or when recording is off, and validates ordering", async () => {
		await withTempDir(async (dir) => {
			const state = fakeState({ project: fakeProject({ dir }) });
			const h = fakePi();
			await h.load(browserPack(state));
			await h.load(flowsPack(state));
			await expect(h.call(FLOW_TOOLS.flowEnd, { name: "x", ok: true })).rejects.toThrow(/flow_start/);
			await h.call(FLOW_TOOLS.flowStart, { name: "checkout" });
			await h.call(BROWSER_TOOLS.navigate, { url: "/cart" });
			await expect(h.call(FLOW_TOOLS.flowEnd, { name: "other", ok: true })).rejects.toThrow(/checkout/);
			const failed = await h.call<{ error?: string }>(FLOW_TOOLS.flowEnd, {
				name: "checkout",
				ok: false,
				error: "no button",
			});
			expect(failed.details.error).toBe("no button");
			expect(state.replaysWritten).toEqual([]);
		});
	});

	it("records startUrl deterministically, relative to the target (#34)", async () => {
		await withTempDir(async (dir) => {
			const page = fakePage("desktop", "http://localhost:3000/cities/beijing/the-forbidden-city");
			const browser = fakeBrowser({ desktop: page });
			const state = fakeState({ project: fakeProject({ dir }), browser });
			const h = fakePi();
			await h.load(browserPack(state));
			await h.load(flowsPack(state));

			// A flow that navigates first starts at the target root, whatever page was left open.
			await h.call(FLOW_TOOLS.flowStart, { name: "smoke" });
			await h.call(BROWSER_TOOLS.navigate, { url: "/" });
			await h.call(FLOW_TOOLS.flowEnd, { name: "smoke", ok: true });

			// A flow that acts on the current page keeps it, as a path on the target.
			page.setUrl("http://localhost:3000/login?next=%2Fevents%2Fnew");
			page.nextSnapshot = snapshot({ interactive: [element({ ref: "e1", name: "Sign in", testId: "go" })] });
			await h.call(BROWSER_TOOLS.pageSnapshot, {});
			await h.call(FLOW_TOOLS.flowStart, { name: "guide" });
			await h.call(BROWSER_TOOLS.click, { target: "ref=e1" });
			await h.call(FLOW_TOOLS.flowEnd, { name: "guide", ok: true });

			const read = async (name: string) =>
				JSON.parse(await readFile(join(dir, ".gribble", "flows", `${name}.replay.json`), "utf8"));
			expect((await read("smoke")).startUrl).toBe("/");
			expect((await read("guide")).startUrl).toBe("/login?next=%2Fevents%2Fnew");
		});
	});

	it("relativeToTarget keeps other origins and maps about:blank to the target", () => {
		const target = "http://localhost:3000/app/";
		expect(relativeToTarget("http://localhost:3000/app/cart?x=1#top", target)).toBe("/app/cart?x=1#top");
		expect(relativeToTarget("about:blank", target)).toBe("/app/");
		expect(relativeToTarget(target, target)).toBe("/app/");
		expect(relativeToTarget("/login?next=%2F", target)).toBe("/login?next=%2F");
		expect(relativeToTarget("https://auth.example.com/login", target)).toBe("https://auth.example.com/login");
	});

	it("prefers stable selectors and quotes names (#33)", () => {
		const card = element({
			ref: "e1",
			role: "link",
			tag: "a",
			name: 'Visas "and" entry',
			href: "/guides/visas",
			selector: "main > a",
		});
		expect(replaySelectorCandidates(card)).toEqual([
			'a[href="/guides/visas"]',
			'role=link[name="Visas \\"and\\" entry"]',
			"main > a",
		]);
		expect(replaySelectorCandidates({ ...card, href: "https://elsewhere.example/x" })[0]).toBe(
			'role=link[name="Visas \\"and\\" entry"]',
		);
		expect(replaySelectorCandidates({ ...card, href: "#top", testId: "visas", id: "a b" })).toEqual([
			'[data-testid="visas"]',
			'[id="a b"]',
			'role=link[name="Visas \\"and\\" entry"]',
			"main > a",
		]);
	});

	it("does not write a replay whose selectors do not resolve on the live page (#33)", async () => {
		await withTempDir(async (dir) => {
			const events: AuditEvent[] = [];
			const page = fakePage();
			const matched: string[] = [];
			page.matchSelector = async (selector) => {
				matched.push(selector);
				return { count: 0, sameElement: false };
			};
			const state = fakeState({
				project: fakeProject({ dir }),
				browser: fakeBrowser({ desktop: page }),
				events,
			});
			const h = fakePi();
			await h.load(browserPack(state));
			await h.load(flowsPack(state));
			page.nextSnapshot = snapshot({
				interactive: [element({ ref: "e1", role: "link", tag: "a", name: "Visas", href: "/guides/visas" })],
			});
			await h.call(BROWSER_TOOLS.pageSnapshot, {});
			await h.call(FLOW_TOOLS.flowStart, { name: "guide" });
			await h.call(BROWSER_TOOLS.click, { target: "ref=e1" });
			await h.call(BROWSER_TOOLS.click, { target: "ref=e9" });
			const end = await h.call<{ replay?: string; replaySkipped?: string }>(FLOW_TOOLS.flowEnd, {
				name: "guide",
				ok: true,
			});
			expect(matched).toEqual(['a[href="/guides/visas"]', 'role=link[name="Visas"]', "#e1"]);
			expect(end.details.replay).toBeUndefined();
			expect(end.details.replaySkipped).toMatch(/step 1: no selector for e1 "Visas"/);
			expect(end.details.replaySkipped).toMatch(/step 2: ref e9 is not in the last page_snapshot/);
			expect(state.replaysWritten).toEqual([]);
			expect(events).toContainEqual(
				expect.objectContaining({ type: "log", level: "warn", message: expect.stringContaining("guide") }),
			);
		});
	});

	it("propose_flow writes flows/proposed/<slug>.md with frontmatter", async () => {
		await withTempDir(async (dir) => {
			const state = fakeState({ project: fakeProject({ dir }) });
			const h = fakePi();
			await h.load(flowsPack(state));
			const result = await h.call<{ file: string }>(FLOW_TOOLS.proposeFlow, {
				name: "Password reset",
				description: "1. Open /login\n2. Click Forgot password\n3. Expect an email notice",
				requires_auth: "user",
			});
			expect(result.details.file).toBe(join(dir, ".gribble", "flows", "proposed", "password-reset.md"));
			const text = await readFile(result.details.file, "utf8");
			expect(text).toBe(
				"---\nname: Password reset\nrequires_auth: user\ntags: [proposed]\n---\n\n1. Open /login\n2. Click Forgot password\n3. Expect an email notice\n",
			);
			expect(state.proposedFlows).toEqual([result.details.file]);
		});
	});

	it("flowSlug", () => {
		expect(flowSlug("Checkout: happy path!")).toBe("checkout-happy-path");
		expect(flowSlug("   ")).toBe("flow");
	});
});
