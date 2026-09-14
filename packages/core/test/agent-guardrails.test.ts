import { describe, expect, it } from "vitest";
import {
	BROWSER_TOOLS,
	CORE_TOOLS,
	guardrails,
	isSideEffectSafeHost,
	LOADER_TOOL,
	REPORT_TOOLS,
	SIDE_EFFECT_PATTERN,
} from "../src/index.js";
import {
	element,
	type FakePage,
	fakePi,
	fakeProject,
	fakeState,
	snapshot,
	toolCall,
	toolResult,
} from "./agent-helpers.js";

async function setup(
	opts: { project?: ReturnType<typeof fakeProject>; env?: NodeJS.ProcessEnv; initialTools?: string[] } = {},
) {
	const state = fakeState({ project: opts.project, env: opts.env });
	const harness = fakePi();
	// A few pack-like tools so the loader and session_start have something to work with.
	for (const name of [
		"navigate",
		"click",
		"fill",
		"add_finding",
		"finalize_report",
		"run_lighthouse",
		"check_links",
	]) {
		harness.pi.registerTool({
			name,
			label: name,
			description:
				name === "run_lighthouse"
					? "Run Lighthouse on the current page: performance score, LCP, CLS."
					: name === "check_links"
						? "Run the deterministic link checker: broken links, redirect chains."
						: `${name} tool`,
			parameters: {} as never,
			execute: async () => ({ content: [], details: {} }),
		});
	}
	await harness.load(guardrails(state, { initialTools: opts.initialTools ?? CORE_TOOLS }));
	return { state, ...harness };
}

describe("guardrails: origin allow-list", () => {
	it("allows the target host and configured origins, blocks the rest", async () => {
		const h = await setup();
		expect(await h.emit(toolCall(BROWSER_TOOLS.navigate, { url: "/pricing" }))).toBeUndefined();
		expect(
			await h.emit(toolCall(BROWSER_TOOLS.navigate, { url: "http://127.0.0.1:3000/x" })),
		).toBeUndefined();
		expect(
			await h.emit(toolCall(BROWSER_TOOLS.navigate, { url: "https://my-app-abc.vercel.app/" })),
		).toBeUndefined();
		const blocked = (await h.emit(
			toolCall(BROWSER_TOOLS.navigate, { url: "https://evil.example.com/" }),
		)) as {
			block: boolean;
			reason: string;
		};
		expect(blocked.block).toBe(true);
		expect(blocked.reason).toMatch(/evil\.example\.com/);
	});

	it("blocks clicks on links that leave the allowed origins, using the last snapshot", async () => {
		const h = await setup();
		h.state.lastSnapshot = snapshot({
			interactive: [
				element({ ref: "e1", role: "link", name: "Twitter", href: "https://twitter.com/gribble" }),
				element({ ref: "e2", role: "link", name: "Docs", href: "/docs" }),
				element({ ref: "e3", role: "link", name: "Mail", href: "mailto:hi@example.com" }),
			],
		});
		const blocked = (await h.emit(toolCall(BROWSER_TOOLS.click, { target: "ref=e1" }))) as { block: boolean };
		expect(blocked.block).toBe(true);
		expect(await h.emit(toolCall(BROWSER_TOOLS.click, { target: "ref=e2" }))).toBeUndefined();
		expect(await h.emit(toolCall(BROWSER_TOOLS.click, { target: "ref=e3" }))).toBeUndefined();
		expect(await h.emit(toolCall(BROWSER_TOOLS.click, { target: "ref=e99" }))).toBeUndefined();
	});
});

describe("guardrails: side effects", () => {
	it("recognizes dangerous accessible names and safe hosts", () => {
		expect(SIDE_EFFECT_PATTERN.test("Place order")).toBe(true);
		expect(SIDE_EFFECT_PATTERN.test("Delete account")).toBe(true);
		expect(SIDE_EFFECT_PATTERN.test("Open menu")).toBe(false);
		expect(isSideEffectSafeHost("localhost")).toBe(true);
		expect(isSideEffectSafeHost("my-app-git-main.vercel.app")).toBe(true);
		expect(isSideEffectSafeHost("staging.example.com")).toBe(true);
		expect(isSideEffectSafeHost("shop.example.com")).toBe(false);
		expect(isSideEffectSafeHost("shop.example.com", "preview")).toBe(true);
	});

	it("blocks a purchase click on a production host but not on localhost", async () => {
		const prod = fakeProject({
			yaml: "target:\n  url: https://shop.example.com\n",
		});
		const h = await setup({ project: prod });
		const page = (await h.state.currentPage()) as FakePage;
		page.setUrl("https://shop.example.com/cart");
		h.state.lastSnapshot = snapshot({ interactive: [element({ ref: "e1", name: "Place order" })] });
		const blocked = (await h.emit(toolCall(BROWSER_TOOLS.click, { target: "ref=e1" }))) as {
			block: boolean;
			reason: string;
		};
		expect(blocked.block).toBe(true);
		expect(blocked.reason).toMatch(/side effect/);

		const local = await setup();
		local.state.lastSnapshot = snapshot({ interactive: [element({ ref: "e1", name: "Place order" })] });
		expect(await local.emit(toolCall(BROWSER_TOOLS.click, { target: "ref=e1" }))).toBeUndefined();
	});
});

describe("guardrails: budgets", () => {
	it("blocks with terminate at max_steps, nudges once, and lets add_finding/finalize_report through", async () => {
		const project = fakeProject({
			yaml: "target:\n  url: http://localhost:3000\nbudget: { max_steps: 2 }\n",
		});
		const h = await setup({ project });
		expect(await h.emit(toolCall("navigate", { url: "/" }))).toBeUndefined();
		expect(await h.emit(toolCall("navigate", { url: "/a" }))).toBeUndefined();
		const blocked = (await h.emit(toolCall("navigate", { url: "/b" }))) as {
			block: boolean;
			terminate?: boolean;
			reason: string;
		};
		expect(blocked.block).toBe(true);
		expect(blocked.terminate).toBe(true);
		expect(blocked.reason).toMatch(/finalize_report/);
		expect(h.state.budget.exhausted).toBe(true);
		expect(h.sent).toHaveLength(1);
		expect(h.sent[0]?.options).toMatchObject({ deliverAs: "steer", triggerTurn: true });
		// only one nudge
		await h.emit(toolCall("navigate", { url: "/c" }));
		expect(h.sent).toHaveLength(1);
		expect(await h.emit(toolCall(REPORT_TOOLS.addFinding, {}))).toBeUndefined();
		expect(await h.emit(toolCall(REPORT_TOOLS.finalizeReport, {}))).toBeUndefined();
	});

	it("hard-stops even exempt tools well past the cap", async () => {
		const project = fakeProject({
			yaml: "target:\n  url: http://localhost:3000\nbudget: { max_steps: 1 }\n",
		});
		const h = await setup({ project });
		for (let i = 0; i < 30; i++) await h.emit(toolCall(REPORT_TOOLS.addFinding, {}));
		const blocked = (await h.emit(toolCall(REPORT_TOOLS.addFinding, {}))) as {
			block: boolean;
			terminate?: boolean;
		};
		expect(blocked.block).toBe(true);
		expect(h.state.terminated).toBe(true);
	});

	it("aborts the session when the token budget is exceeded on turn_end", async () => {
		const project = fakeProject({
			yaml: "target:\n  url: http://localhost:3000\nbudget: { max_tokens: 1000 }\n",
		});
		const h = await setup({ project });
		const turn = (total: number) => ({
			type: "turn_end",
			turnIndex: 0,
			toolResults: [],
			message: {
				role: "assistant",
				usage: { input: total - 10, output: 10, totalTokens: total, cost: { total: 0.01 } },
			},
		});
		await h.emit(turn(600));
		expect(h.state.budget.exhausted).toBe(false);
		expect(h.ctx.abort).not.toHaveBeenCalled();
		await h.emit(turn(600));
		expect(h.state.usage.tokens).toBe(1200);
		expect(h.state.budget.exhausted).toBe(true);
		expect(h.state.budget.reason).toMatch(/token budget/);
		expect(h.ctx.abort).toHaveBeenCalledTimes(1);
	});

	it("aborts on the cost budget", async () => {
		const project = fakeProject({
			yaml: "target:\n  url: http://localhost:3000\nbudget: { max_cost_usd: 0.05 }\n",
		});
		const h = await setup({ project });
		await h.emit({
			type: "turn_end",
			turnIndex: 0,
			toolResults: [],
			message: { role: "assistant", usage: { input: 1, output: 1, totalTokens: 2, cost: { total: 0.06 } } },
		});
		expect(h.state.budget.reason).toMatch(/cost budget/);
		expect(h.ctx.abort).toHaveBeenCalled();
	});
});

describe("guardrails: redaction", () => {
	const env = { GRIBBLE_USER_EMAIL: "ada@example.com", GRIBBLE_USER_PASSWORD: "hunter2-secret" };

	it("redacts secret values in tool inputs in place and in tool results", async () => {
		const h = await setup({ env });
		expect(h.state.secrets).toEqual(["ada@example.com", "hunter2-secret"]);
		const event = toolCall(BROWSER_TOOLS.fill, {
			target: "#pw",
			value: "hunter2-secret",
			nested: { note: "email ada@example.com" },
		});
		await h.emit(event);
		expect(event.input).toEqual({ target: "#pw", value: "***", nested: { note: "email ***" } });
		const patched = (await h.emit(
			toolResult("extract_text", "Signed in as ada@example.com with hunter2-secret"),
		)) as {
			content: Array<{ text: string }>;
		};
		expect(patched.content[0]?.text).toBe("Signed in as *** with ***");
		expect(await h.emit(toolResult("extract_text", "nothing secret here"))).toBeUndefined();
	});
});

describe("guardrails: session_start, summary injection and search_tools", () => {
	it("narrows the active tools to the initial set on session_start", async () => {
		const h = await setup({
			initialTools: ["navigate", "click", "add_finding", "finalize_report", LOADER_TOOL],
		});
		await h.emit({ type: "session_start", reason: "startup" });
		expect(h.pi.getActiveTools().sort()).toEqual([
			"add_finding",
			"click",
			"finalize_report",
			"find",
			"grep",
			"ls",
			"navigate",
			"read",
			"search_tools",
		]);
		expect(h.pi.getAllTools().map((t) => t.name)).toContain("run_lighthouse");
	});

	it("injects the deterministic summary once as a custom message", async () => {
		const state = fakeState();
		Object.assign(state, { deterministicSummary: "- **links/broken** (1)\n  - error · / · Broken link" });
		const h = fakePi();
		await h.load(guardrails(state, { initialTools: CORE_TOOLS }));
		const first = (await h.emit({
			type: "before_agent_start",
			prompt: "x",
			systemPrompt: "",
			systemPromptOptions: {},
		})) as {
			message: { customType: string; content: string };
		};
		expect(first.message.customType).toBe("gribble-deterministic-summary");
		expect(first.message.content).toContain("links/broken");
		expect(
			await h.emit({ type: "before_agent_start", prompt: "y", systemPrompt: "", systemPromptOptions: {} }),
		).toBeUndefined();
	});

	it("search_tools enables inactive tools by keyword, additively", async () => {
		const h = await setup({ initialTools: ["navigate", LOADER_TOOL] });
		await h.emit({ type: "session_start", reason: "startup" });
		const result = await h.call<{ added: string[] }>(LOADER_TOOL, { query: "lighthouse performance" });
		expect(result.details.added).toEqual(["run_lighthouse"]);
		expect(h.pi.getActiveTools()).toContain("run_lighthouse");
		expect(h.pi.getActiveTools()).toContain("navigate");
		const none = await h.call<{ added: string[] }>(LOADER_TOOL, { query: "quantum" });
		expect(none.details.added).toEqual([]);
		expect(none.content[0]?.text).toMatch(/check_links/);
	});
});

describe("guardrails: context elision", () => {
	const big = (tool: string, i: number) => ({
		role: "toolResult",
		toolCallId: `c${i}`,
		toolName: tool,
		content: [{ type: "text", text: `${tool} result ${i} ${"x".repeat(5_000)}` }],
	});

	it("keeps the last three large tool results and elides older ones", async () => {
		const h = await setup();
		const messages = [
			{ role: "user", content: [{ type: "text", text: "go" }] },
			big("page_snapshot", 1),
			{ role: "toolResult", toolCallId: "s", toolName: "click", content: [{ type: "text", text: "ok" }] },
			big("page_snapshot", 2),
			big("read", 3),
			big("page_snapshot", 4),
			big("page_snapshot", 5),
		];
		const result = await h.emit<{ messages: typeof messages }>({ type: "context", messages });
		expect(result).toBeDefined();
		const texts = result!.messages.map((m) => m.content[0]!.text!);
		expect(texts[1]).toContain("elided from context");
		expect(texts[1]).toContain("page_snapshot again");
		expect(texts[1]!.length).toBeLessThan(600);
		expect(texts[2]).toBe("ok");
		expect(texts[3]).toContain("elided from context");
		for (const i of [4, 5, 6]) expect(texts[i]!.length).toBeGreaterThan(5_000);
	});

	it("returns nothing when there is nothing to elide", async () => {
		const h = await setup();
		const messages = [big("page_snapshot", 1), big("page_snapshot", 2)];
		expect(await h.emit({ type: "context", messages })).toBeUndefined();
	});
});

describe("guardrails: low-budget warning", () => {
	it("steers the model once when 75% of the token budget is used", async () => {
		const h = await setup();
		h.state.budget.maxTokens = 1_000;
		h.state.budget.maxSteps = 100;
		const turn = (tokens: number) => ({
			type: "turn_end",
			turnIndex: 0,
			message: {
				role: "assistant",
				usage: { totalTokens: tokens, input: tokens, output: 0, cost: { total: 0 } },
			},
			toolResults: [],
		});
		await h.emit(turn(500));
		expect(h.sent).toHaveLength(0);
		await h.emit(turn(300));
		expect(h.sent).toHaveLength(1);
		expect(JSON.stringify(h.sent[0])).toContain("finalize_report");
		await h.emit(turn(100));
		expect(h.sent).toHaveLength(1);
		expect(h.state.budget.exhausted).toBe(false);
	});
});
