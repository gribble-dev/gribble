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
} from "../src/index.js";
import {
	element,
	fakeBrowser,
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
			expect(replay.startUrl).toBe("http://localhost:3000");
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
