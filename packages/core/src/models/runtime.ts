/**
 * Model runtime and auth on top of pi's `ModelRuntime`. Gribble never writes auth.json itself;
 * pi's credential store does, pointed at the Gribble agent directory.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, AuthInteraction, AuthPrompt, Model } from "@earendil-works/pi-ai";
import { ModelRuntime, resolveCliModel } from "@earendil-works/pi-coding-agent";
import { agentDirFiles } from "./agent-dir.js";
import { rankModels } from "./rank.js";
import { parseModelSpec } from "./spec.js";
import type {
	CreateModelRuntime,
	CreateModelRuntimeOptions,
	LoginProvider,
	ModelResolution,
	ResolveModel,
} from "./types.js";

/** The configured or requested model exists but its provider has no credentials. */
export class ModelAuthError extends Error {
	readonly provider: string;
	readonly envVar?: string;
	constructor(message: string, opts: { provider: string; envVar?: string }) {
		super(message);
		this.name = "ModelAuthError";
		this.provider = opts.provider;
		this.envVar = opts.envVar;
	}
}

/** No model can be used at all. */
export class NoModelError extends Error {
	constructor(message = "No model available. Run `gribble login`.") {
		super(message);
		this.name = "NoModelError";
	}
}

/** The model spec cannot be resolved to a model in the catalog. */
export class UnknownModelError extends Error {
	readonly spec: string;
	constructor(spec: string, detail?: string) {
		super(
			`Model "${spec}" is not in the catalog.${detail ? ` ${detail}` : ""} Run \`gribble models\` to see what is available.`,
		);
		this.name = "UnknownModelError";
		this.spec = spec;
	}
}

/**
 * Environment variable pi reads for a provider's API key. Providers not listed follow the
 * `<PROVIDER>_API_KEY` convention pi uses for most of its catalog.
 */
const PROVIDER_ENV_VARS: Record<string, string> = {
	anthropic: "ANTHROPIC_API_KEY",
	openai: "OPENAI_API_KEY",
	google: "GEMINI_API_KEY",
	"google-vertex": "GOOGLE_CLOUD_API_KEY",
	"azure-openai-responses": "AZURE_OPENAI_API_KEY",
	openrouter: "OPENROUTER_API_KEY",
	"vercel-ai-gateway": "AI_GATEWAY_API_KEY",
	groq: "GROQ_API_KEY",
	xai: "XAI_API_KEY",
	mistral: "MISTRAL_API_KEY",
	deepseek: "DEEPSEEK_API_KEY",
	cerebras: "CEREBRAS_API_KEY",
	huggingface: "HF_TOKEN",
	together: "TOGETHER_API_KEY",
	fireworks: "FIREWORKS_API_KEY",
	moonshotai: "MOONSHOT_API_KEY",
	"github-copilot": "COPILOT_GITHUB_TOKEN",
	"amazon-bedrock": "AWS_PROFILE",
};

/** Best-effort name of the environment variable that configures a provider's API key. */
export function providerEnvVar(providerId: string): string {
	return PROVIDER_ENV_VARS[providerId] ?? `${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

/**
 * pi's runtime pointed at the Gribble agent directory. Catalog refresh over the network is off;
 * pi picks up API keys from `process.env` on its own. When `env` is given and differs from the
 * process environment, keys found there are applied as runtime overrides (not persisted).
 */
export const createModelRuntime: CreateModelRuntime = async (opts: CreateModelRuntimeOptions) => {
	const files = agentDirFiles(opts.agentDir);
	const runtime = await ModelRuntime.create({
		authPath: files.auth,
		modelsPath: files.models,
		modelsStorePath: files.modelsStore,
		allowModelNetwork: false,
	});
	if (opts.env && opts.env !== process.env) {
		for (const provider of runtime.getProviders()) {
			const envVar = providerEnvVar(provider.id);
			const value = opts.env[envVar];
			if (value && process.env[envVar] !== value && !runtime.hasConfiguredAuth(provider.id)) {
				await runtime.setRuntimeApiKey(provider.id, value);
			}
		}
	}
	return runtime;
};

async function requireAuth(runtime: ModelRuntime, model: Model<Api>, spec: string): Promise<void> {
	const check = await runtime.checkAuth(model.provider);
	if (check) return;
	const envVar = providerEnvVar(model.provider);
	throw new ModelAuthError(
		`Model ${spec} needs credentials for ${model.provider}. Run \`gribble login ${model.provider}\` or set ${envVar}.`,
		{ provider: model.provider, envVar },
	);
}

function findModel(
	runtime: ModelRuntime,
	spec: string,
): { model: Model<Api>; thinking?: ModelResolution["thinking"]; warning?: string } {
	const parsed = parseModelSpec(spec);
	if (parsed) {
		const exact = runtime.getModel(parsed.provider, parsed.id);
		if (exact) return { model: exact, thinking: parsed.thinking };
	}
	// Fuzzy match with pi's own CLI rules (partial ids, names). pi also accepts unknown ids for a
	// known provider as "custom models"; Gribble does not, so a typo in gribble.yaml fails early.
	const resolved = resolveCliModel({ cliModel: spec, modelRuntime: runtime });
	if (resolved.model && runtime.getModel(resolved.model.provider, resolved.model.id)) {
		const thinking =
			resolved.thinkingLevel && resolved.thinkingLevel !== "off" ? resolved.thinkingLevel : parsed?.thinking;
		return { model: resolved.model, thinking, warning: resolved.warning };
	}
	throw new UnknownModelError(spec, resolved.error ?? resolved.warning);
}

/**
 * Resolution order: `configured` (gribble.yaml, must have auth) -> `settingsModel`
 * (~/.gribble/settings.json) -> the first available model ranked by the recommendation table,
 * with a warning -> `NoModelError`.
 */
export const resolveModel: ResolveModel = async (opts) => {
	const { runtime } = opts;
	if (opts.configured?.trim()) {
		const spec = opts.configured.trim();
		const found = findModel(runtime, spec);
		await requireAuth(runtime, found.model, spec);
		return { model: found.model, thinking: found.thinking, warning: found.warning };
	}
	if (opts.settingsModel?.trim()) {
		const spec = opts.settingsModel.trim();
		try {
			const found = findModel(runtime, spec);
			await requireAuth(runtime, found.model, spec);
			return { model: found.model, thinking: found.thinking, warning: found.warning };
		} catch (err) {
			if (!(err instanceof ModelAuthError) && !(err instanceof UnknownModelError)) throw err;
			// fall through to the first available model, keeping the reason in the warning
			const fallback = await firstAvailable(runtime);
			if (!fallback) throw err;
			return {
				...fallback,
				warning: `${err.message} Using ${fallback.model.provider}/${fallback.model.id} instead.`,
			};
		}
	}
	const fallback = await firstAvailable(runtime);
	if (!fallback) throw new NoModelError();
	return {
		...fallback,
		warning: `No model configured; using ${fallback.model.provider}/${fallback.model.id}. Set \`model\` in gribble.yaml to pin it.`,
	};
};

async function firstAvailable(runtime: ModelRuntime): Promise<ModelResolution | undefined> {
	const available = await runtime.getAvailable();
	const ranked = rankModels([...available]);
	const model = ranked[0];
	return model ? { model } : undefined;
}

export interface ProviderInfo {
	id: string;
	name: string;
	/** pi's view of the provider's credentials. */
	auth: { configured: boolean; source?: string; label?: string };
	/** Environment variable that would configure an API key. */
	envVar: string;
	/** The provider offers an OAuth / subscription login. */
	oauth: boolean;
	apiKeyLogin: boolean;
}

/** Providers pi knows, with their auth status; configured ones first. */
export function listProviders(runtime: ModelRuntime): ProviderInfo[] {
	const out: ProviderInfo[] = runtime.getProviders().map((provider) => {
		const status = runtime.getProviderAuthStatus(provider.id);
		return {
			id: provider.id,
			name: provider.name,
			auth: { configured: status.configured, source: status.source, label: status.label },
			envVar: providerEnvVar(provider.id),
			oauth: !!provider.auth.oauth,
			apiKeyLogin: !!provider.auth.apiKey?.login,
		};
	});
	return out.sort(
		(a, b) => Number(b.auth.configured) - Number(a.auth.configured) || a.id.localeCompare(b.id),
	);
}

/** An interaction that answers the provider's secret prompt with a known key and delegates the rest. */
function withApiKey(base: AuthInteraction, apiKey: string): AuthInteraction {
	return {
		signal: base.signal,
		notify: (event) => base.notify(event),
		prompt: (prompt: AuthPrompt) =>
			prompt.type === "secret" ? Promise.resolve(apiKey) : base.prompt(prompt),
	};
}

/**
 * Store credentials for a provider through pi. With `apiKey` the provider's api-key login runs
 * with the key answered automatically; without it the OAuth flow runs (falling back to an
 * interactive api-key prompt when the provider has no OAuth).
 */
export const loginProvider: LoginProvider = async (opts) => {
	const { runtime, provider, interaction } = opts;
	const known = runtime.getProvider(provider);
	if (!known) throw new Error(`Unknown provider "${provider}". Run \`gribble models\` to list providers.`);
	if (opts.apiKey) {
		if (!known.auth.apiKey?.login) {
			throw new Error(
				`${known.name} does not accept an API key login; use \`gribble login ${provider}\` for its OAuth flow.`,
			);
		}
		await runtime.login(provider, "api_key", withApiKey(interaction, opts.apiKey.trim()));
		return;
	}
	if (known.auth.oauth) {
		await runtime.login(provider, "oauth", interaction);
		return;
	}
	if (known.auth.apiKey?.login) {
		await runtime.login(provider, "api_key", interaction);
		return;
	}
	throw new Error(
		`${known.name} uses ambient credentials only (e.g. ${providerEnvVar(provider)}); there is nothing to log in to.`,
	);
};

/** Remove stored credentials for a provider. */
export async function logoutProvider(opts: { runtime: ModelRuntime; provider: string }): Promise<void> {
	await opts.runtime.logout(opts.provider);
}

export interface SessionUsage {
	/** Sum of `usage.totalTokens` over assistant messages. */
	tokens: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	costUsd: number;
	/** Assistant turns. */
	turns: number;
	/** Tool calls the assistant made. */
	steps: number;
}

/** Token and cost totals over a session's messages, from pi's per-message usage and pricing. */
export function usageFromMessages(messages: readonly AgentMessage[]): SessionUsage {
	const out: SessionUsage = {
		tokens: 0,
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		costUsd: 0,
		turns: 0,
		steps: 0,
	};
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		out.turns++;
		const usage = message.usage;
		if (usage) {
			out.tokens += usage.totalTokens ?? 0;
			out.input += usage.input ?? 0;
			out.output += usage.output ?? 0;
			out.cacheRead += usage.cacheRead ?? 0;
			out.cacheWrite += usage.cacheWrite ?? 0;
			out.costUsd += usage.cost?.total ?? 0;
		}
		for (const part of message.content) if (part.type === "toolCall") out.steps++;
	}
	return out;
}
