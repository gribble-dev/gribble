/**
 * Phase-2 signatures for the model runtime (owned by core-agent). Types only: the CLI compiles
 * against these while the implementations land in src/models/runtime.ts.
 */
import type { Api, AuthInteraction, Model, ThinkingLevel } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export type { Api, AuthInteraction, Model, ModelRuntime, ThinkingLevel };

export interface ModelResolution {
	model: Model<Api>;
	thinking?: ThinkingLevel;
	/** Set when the model was not the configured one, e.g. fell back to the first available model. */
	warning?: string;
}

export interface CreateModelRuntimeOptions {
	agentDir: string;
	env?: NodeJS.ProcessEnv;
}

export interface ResolveModelOptions {
	runtime: ModelRuntime;
	/** `model` from gribble.yaml, pi syntax. */
	configured?: string;
	/** Default model from ~/.gribble/settings.json. */
	settingsModel?: string;
}

export interface LoginProviderOptions {
	runtime: ModelRuntime;
	provider: string;
	apiKey?: string;
	interaction: AuthInteraction;
}

export type CreateModelRuntime = (opts: CreateModelRuntimeOptions) => Promise<ModelRuntime>;
export type ResolveModel = (opts: ResolveModelOptions) => Promise<ModelResolution>;
export type LoginProvider = (opts: LoginProviderOptions) => Promise<void>;
