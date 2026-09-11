/**
 * Fakes for agent tests: an in-memory ExtensionAPI, a scripted AuditPage/BrowserSession and a
 * minimal ProjectContext. No pi session, no browser, no network.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	InlineExtension,
	ToolCallEvent,
	ToolDefinition,
	ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";
import type { AuditPage, BrowserSession, InteractiveElement, PageSnapshot } from "../src/browser/types.js";
import type { AuditEvent } from "../src/index.js";
import {
	AgentState,
	type ProjectContext,
	parseGribbleConfig,
	parseRulesConfig,
	resolveRules,
} from "../src/index.js";

// ------------------------------------------------------------------ project

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "gribble-agent-"));
	try {
		return await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

export function fakeProject(
	opts: { dir?: string; yaml?: string; rulesYaml?: string; environment?: string } = {},
): ProjectContext {
	const dir = opts.dir ?? "/tmp/gribble-fake";
	const yaml =
		opts.yaml ??
		`target:
  url: http://localhost:3000
allowed_origins: ["*.vercel.app"]
budget: { max_steps: 200, max_tokens: 2000000 }
auth:
  profiles:
    user:
      type: flow
      flow: flows/auth/login.md
      env: { email: GRIBBLE_USER_EMAIL, password: GRIBBLE_USER_PASSWORD }
`;
	const config = parseGribbleConfig(yaml, { env: {} });
	return {
		repoRoot: dir,
		targetDir: dir,
		gribbleDir: join(dir, ".gribble"),
		targetName: "",
		config,
		rules: resolveRules([parseRulesConfig(opts.rulesYaml ?? "extends: [gribble:recommended]\n")]),
		guidelines: "",
		flows: [],
		environment: opts.environment,
		cascade: [join(dir, ".gribble")],
	};
}

// ------------------------------------------------------------------ browser

export function element(partial: Partial<InteractiveElement> & { ref: string }): InteractiveElement {
	return {
		role: "button",
		name: "",
		tag: "button",
		selector: `#${partial.ref}`,
		box: { x: 0, y: 0, width: 100, height: 40 },
		...partial,
	};
}

export function snapshot(partial: Partial<PageSnapshot> = {}): PageSnapshot {
	return {
		url: "http://localhost:3000/",
		title: "Home",
		status: 200,
		aria: '- banner:\n  - link "Home"\n- main:\n  - heading "Welcome" [level=1]',
		dom: "<main><h1>Welcome</h1></main>",
		interactive: [],
		layout: [],
		styles: [],
		console: [],
		failedRequests: [],
		...partial,
	};
}

export interface FakePage extends AuditPage {
	calls: Array<{ method: string; args: unknown[] }>;
	setUrl(url: string): void;
	nextSnapshot?: PageSnapshot;
}

export function fakePage(viewport = "desktop", startUrl = "about:blank"): FakePage {
	let url = startUrl;
	const calls: FakePage["calls"] = [];
	const page: FakePage = {
		raw: {} as AuditPage["raw"],
		viewport,
		viewportSize: viewport === "mobile" ? { width: 390, height: 844 } : { width: 1366, height: 768 },
		calls,
		nextSnapshot: undefined,
		setUrl: (next) => {
			url = next;
		},
		url: () => url,
		async goto(target, opts) {
			calls.push({ method: "goto", args: [target, opts] });
			url = target;
			return { status: 200, ok: true, finalUrl: target };
		},
		async click(target, opts) {
			calls.push({ method: "click", args: [target, opts] });
		},
		async fill(target, value) {
			calls.push({ method: "fill", args: [target, value] });
		},
		async press(key) {
			calls.push({ method: "press", args: [key] });
		},
		async waitFor(opts) {
			calls.push({ method: "waitFor", args: [opts] });
		},
		async snapshot(opts) {
			calls.push({ method: "snapshot", args: [opts] });
			return page.nextSnapshot ?? snapshot({ url });
		},
		async text(selector) {
			calls.push({ method: "text", args: [selector] });
			return selector === "title" ? "Home" : "Welcome to the site";
		},
		async screenshot(opts) {
			calls.push({ method: "screenshot", args: [opts] });
			return Buffer.from("png");
		},
		drainConsole: () => [],
		drainFailedRequests: () => [],
		requests: () => [],
		async resolveRef(ref) {
			return page.nextSnapshot?.interactive.find((el) => el.ref === ref);
		},
		lastNavigation: () => undefined,
		async close() {
			calls.push({ method: "close", args: [] });
		},
	};
	return page;
}

export function fakeBrowser(
	pages: Record<string, FakePage> = {},
): BrowserSession & { pages: Record<string, FakePage> } {
	return {
		baseUrl: "http://localhost:3000",
		pages,
		async newPage(opts) {
			const viewport = opts?.viewport ?? "desktop";
			pages[viewport] ??= fakePage(viewport);
			return pages[viewport];
		},
		async cdpEndpoint() {
			return "ws://localhost:0";
		},
		cdpPort: () => 0,
		async close() {},
	};
}

// -------------------------------------------------------------------- state

export function fakeState(
	opts: {
		project?: ProjectContext;
		env?: NodeJS.ProcessEnv;
		runDir?: string;
		browser?: BrowserSession;
		events?: AuditEvent[];
		flows?: ProjectContext["flows"];
	} = {},
): AgentState {
	const project = opts.project ?? fakeProject();
	const events = opts.events;
	return new AgentState({
		project,
		targetName: project.targetName,
		browser: opts.browser ?? fakeBrowser(),
		env: opts.env ?? {},
		runDir: opts.runDir ?? join(project.gribbleDir, "runs", "test"),
		flows: opts.flows,
		onEvent: events ? (e) => events.push(e) : undefined,
	});
}

// ------------------------------------------------------------ extension api

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

export interface FakePi {
	pi: ExtensionAPI;
	tools: Map<string, ToolDefinition>;
	handlers: Map<string, Handler[]>;
	sent: Array<{ message: unknown; options: unknown }>;
	ctx: ExtensionContext;
	/** Run every handler for an event in order; the first defined result wins (like pi's blocking hooks). */
	emit<R = unknown>(
		event: { type: string; [key: string]: unknown } | ToolCallEvent | ToolResultEvent,
	): Promise<R | undefined>;
	/** Run a registered tool's execute with the fake context. */
	call<T = unknown>(
		name: string,
		params: Record<string, unknown>,
	): Promise<{ content: Array<{ type: string; text?: string }>; details: T; terminate?: boolean }>;
	load(extension: InlineExtension): Promise<void>;
}

export function fakePi(opts: { builtins?: string[] } = {}): FakePi {
	const tools = new Map<string, ToolDefinition>();
	const handlers = new Map<string, Handler[]>();
	const sent: FakePi["sent"] = [];
	const builtins = opts.builtins ?? ["read", "grep", "find", "ls"];
	let active: string[] = [...builtins];
	const ctx = {
		cwd: "/tmp",
		hasUI: false,
		mode: "print",
		abort: vi.fn(),
		isIdle: () => true,
		signal: undefined,
		ui: { notify: vi.fn() },
	} as unknown as ExtensionContext;

	const pi = {
		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerTool(definition: ToolDefinition) {
			tools.set(definition.name, definition);
			if (!active.includes(definition.name)) active.push(definition.name);
		},
		sendMessage(message: unknown, options?: unknown) {
			sent.push({ message, options });
		},
		getActiveTools: () => [...active],
		getAllTools: () => [
			...builtins.map((name) => ({
				name,
				description: `builtin ${name}`,
				parameters: {},
				promptGuidelines: undefined,
				sourceInfo: { source: "builtin", path: `<builtin:${name}>`, scope: "temporary", origin: "top-level" },
			})),
			...[...tools.values()].map((t) => ({
				name: t.name,
				description: t.description,
				parameters: t.parameters,
				promptGuidelines: t.promptGuidelines,
				sourceInfo: { source: "extension", path: "<inline>", scope: "temporary", origin: "top-level" },
			})),
		],
		setActiveTools(names: string[]) {
			active = names.filter((n) => builtins.includes(n) || tools.has(n));
		},
		registerCommand: vi.fn(),
		registerShortcut: vi.fn(),
		registerFlag: vi.fn(),
		getFlag: vi.fn(),
		registerMessageRenderer: vi.fn(),
		registerMarkdownTransformer: vi.fn(),
		registerEntryRenderer: vi.fn(),
		sendUserMessage: vi.fn(),
		appendEntry: vi.fn(),
		setSessionName: vi.fn(),
		getSessionName: vi.fn(),
		setLabel: vi.fn(),
		exec: vi.fn(),
		getCommands: vi.fn(() => []),
		setModel: vi.fn(),
		getThinkingLevel: vi.fn(),
		setThinkingLevel: vi.fn(),
		registerProvider: vi.fn(),
		unregisterProvider: vi.fn(),
		events: { on: vi.fn(), emit: vi.fn(), off: vi.fn() },
	} as unknown as ExtensionAPI;

	return {
		pi,
		tools,
		handlers,
		sent,
		ctx,
		async emit(event) {
			let result: unknown;
			for (const handler of handlers.get(event.type) ?? []) {
				const out = await handler(event, ctx);
				if (out !== undefined && result === undefined) result = out;
			}
			return result as never;
		},
		async call(name, params) {
			const tool = tools.get(name);
			if (!tool) throw new Error(`tool ${name} is not registered`);
			return (await tool.execute(`call-${name}`, params, undefined, undefined, ctx)) as never;
		},
		async load(extension) {
			if (typeof extension === "function") await extension(pi);
			else await extension.factory(pi);
		},
	};
}

export function toolCall(toolName: string, input: Record<string, unknown>): ToolCallEvent {
	return { type: "tool_call", toolCallId: `id-${toolName}`, toolName, input } as ToolCallEvent;
}

export function toolResult(toolName: string, text: string): ToolResultEvent {
	return {
		type: "tool_result",
		toolCallId: `id-${toolName}`,
		toolName,
		input: {},
		content: [{ type: "text", text }],
		details: undefined,
		isError: false,
	} as ToolResultEvent;
}
