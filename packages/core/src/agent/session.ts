/**
 * The one `createAgentSession` call (brief §4.1). Everything Gribble-specific is injected:
 * a fixed system prompt, no skills, no AGENTS.md, the tool packs as inline extensions, the
 * guardrails, and a read-only set of built-in tools.
 */
import { join } from "node:path";
import {
	type AgentSession,
	createAgentSession,
	createEventBus,
	DefaultResourceLoader,
	type InlineExtension,
	type ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createModelRuntime } from "../models/runtime.js";
import type { ModelResolution } from "../models/types.js";
import { buildSystemPrompt } from "../prompt/system.js";
import { guardrails } from "./guardrails.js";
import { ALL_PACK_TOOLS, BROWSER_TOOLS, BUILTIN_TOOLS, CORE_TOOLS } from "./names.js";
import { AgentState, type AgentStateOptions } from "./state.js";
import { browserPack } from "./tools/browser.js";
import { a11yPack, crawlPack, perfPack, seoPack } from "./tools/checks.js";
import { flowsPack } from "./tools/flows.js";
import { repoPack } from "./tools/repo.js";
import { reportPack } from "./tools/report.js";
import { visualPack } from "./tools/visual.js";

export const SESSIONS_DIR = "sessions";

export type ToolPackSet = "review" | "auth";

export interface CreateGribbleSessionOptions extends AgentStateOptions {
	agentDir: string;
	ci: boolean;
	model: ModelResolution;
	/** Where session files go when not in CI. Default `<gribbleDir>/sessions`. */
	sessionDir?: string;
	/** Reuse an existing runtime; otherwise one is created from `agentDir`. */
	modelRuntime?: ModelRuntime;
	/** Which packs to load. `review` loads everything; `auth` loads the browser and flow packs only. */
	packs?: ToolPackSet;
	/** Tools active on the first turn. Default: the core set (plus screenshot / set_viewport when applicable). */
	initialTools?: readonly string[];
	/** Override the system prompt; default `buildSystemPrompt` from the project. */
	systemPrompt?: string;
}

export interface GribbleSession {
	session: AgentSession;
	state: AgentState;
	dispose(): Promise<void>;
}

/** Packs for a pack set, guardrails first so its `tool_call` hook runs before any tool. */
export function packsFor(
	state: AgentState,
	set: ToolPackSet,
	initialTools: readonly string[],
): InlineExtension[] {
	const core = [guardrails(state, { initialTools }), browserPack(state), flowsPack(state)];
	if (set === "auth") return core;
	return [
		...core,
		repoPack(state),
		reportPack(state),
		crawlPack(state),
		perfPack(state),
		a11yPack(state),
		seoPack(state),
		visualPack(state),
	];
}

/** The default initial tool set for a state: core tools plus screenshot and set_viewport when they exist. */
export function defaultInitialTools(state: AgentState): string[] {
	const tools = [...CORE_TOOLS];
	if (state.vision) tools.push(BROWSER_TOOLS.screenshot);
	if (state.viewportNames.length > 1) tools.push(BROWSER_TOOLS.setViewport);
	return tools;
}

export async function createGribbleSession(opts: CreateGribbleSessionOptions): Promise<GribbleSession> {
	const state = new AgentState(opts);
	const repoRoot = opts.project.repoRoot;
	const packSet = opts.packs ?? "review";
	const initialTools = opts.initialTools ? [...opts.initialTools] : defaultInitialTools(state);
	const systemPrompt =
		opts.systemPrompt ??
		buildSystemPrompt({
			guidelines: opts.project.guidelines,
			config: opts.project.config,
			vision: state.vision,
		});

	const settingsManager = SettingsManager.create(repoRoot, opts.agentDir);
	settingsManager.applyOverrides({ compaction: { enabled: true } });

	const eventBus = createEventBus();
	const loader = new DefaultResourceLoader({
		cwd: repoRoot,
		agentDir: opts.agentDir,
		settingsManager,
		eventBus,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPromptOverride: () => systemPrompt,
		skillsOverride: () => ({ skills: [], diagnostics: [] }),
		agentsFilesOverride: () => ({ agentsFiles: [] }),
		promptsOverride: () => ({ prompts: [], diagnostics: [] }),
		extensionFactories: packsFor(state, packSet, initialTools),
	});
	await loader.reload();

	const modelRuntime =
		opts.modelRuntime ?? (await createModelRuntime({ agentDir: opts.agentDir, env: opts.env }));
	const sessionManager = opts.ci
		? SessionManager.inMemory(repoRoot)
		: SessionManager.create(repoRoot, opts.sessionDir ?? join(opts.project.gribbleDir, SESSIONS_DIR));

	// pi drops extension tools that are not in the allowlist, so every pack tool is listed here and
	// the guardrails narrow the active set to `initialTools` in `session_start`.
	const { session } = await createAgentSession({
		cwd: repoRoot,
		agentDir: opts.agentDir,
		model: opts.model.model,
		thinkingLevel: opts.model.thinking,
		modelRuntime,
		resourceLoader: loader,
		tools: [...BUILTIN_TOOLS, ...ALL_PACK_TOOLS],
		sessionManager,
		settingsManager,
	});

	// createAgentSession does not emit session_start on its own; the run modes do it through
	// bindExtensions. Binding in print mode gives extensions a no-op UI and lets ctx.abort() work.
	await session.bindExtensions({
		mode: "print",
		onError: (err) => state.log("error", `Extension error (${err.extensionPath}): ${err.error}`),
	});

	const unsubscribe = session.subscribe((event) => state.emit({ type: "agent", event }));

	let disposed = false;
	return {
		session,
		state,
		async dispose() {
			if (disposed) return;
			disposed = true;
			unsubscribe();
			try {
				session.dispose();
			} finally {
				await state.closePages({ keep: opts.page });
			}
		},
	};
}
