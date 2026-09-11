import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AuthInteraction } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
	listProviders,
	loginProvider,
	ModelAuthError,
	NoModelError,
	providerEnvVar,
	resolveModel,
	UnknownModelError,
	usageFromMessages,
} from "../src/index.js";

function model(provider: string, id: string) {
	return {
		provider,
		id,
		name: id,
		api: "anthropic-messages",
		baseUrl: "",
		reasoning: false,
		input: ["text"],
		cost: {},
		contextWindow: 1,
		maxTokens: 1,
	};
}

/** A runtime double: only the members the resolver and login use. */
function stubRuntime(opts: { models: ReturnType<typeof model>[]; authed: string[]; oauth?: string[] }) {
	const login = vi.fn(async (providerId: string, type: string, interaction: AuthInteraction) => {
		if (type === "api_key") {
			const key = await interaction.prompt({ type: "secret", message: `Enter ${providerId} key` });
			return { type: "api_key", key };
		}
		interaction.notify({ type: "auth_url", url: "https://example.com/oauth" });
		return { type: "oauth", refresh: "r", access: "a", expires: 0 };
	});
	const providers = [...new Set(opts.models.map((m) => m.provider))].map((id) => ({
		id,
		name: id.toUpperCase(),
		auth: {
			apiKey: { name: `${id} key`, login: async () => ({ type: "api_key" }) },
			oauth: opts.oauth?.includes(id) ? { name: "sub" } : undefined,
		},
	}));
	const runtime = {
		getModel: (provider: string, id: string) =>
			opts.models.find((m) => m.provider === provider && m.id === id),
		getModels: () => opts.models,
		hasConfiguredAuth: (provider: string) => opts.authed.includes(provider),
		checkAuth: async (provider: string) => (opts.authed.includes(provider) ? { type: "api_key" } : undefined),
		getAvailable: async () => opts.models.filter((m) => opts.authed.includes(m.provider)),
		getProviders: () => providers,
		getProvider: (id: string) => providers.find((p) => p.id === id),
		getProviderAuthStatus: (id: string) => ({
			configured: opts.authed.includes(id),
			source: opts.authed.includes(id) ? "environment" : undefined,
		}),
		login,
		logout: vi.fn(async () => {}),
	};
	return { runtime: runtime as unknown as ModelRuntime, login };
}

const models = [
	model("anthropic", "claude-sonnet-9"),
	model("openai", "gpt-9-mini"),
	model("acme", "acme-large"),
];

describe("resolveModel", () => {
	it("uses the configured model when its provider has auth, with thinking from the spec", async () => {
		const { runtime } = stubRuntime({ models, authed: ["anthropic"] });
		const result = await resolveModel({ runtime, configured: "anthropic/claude-sonnet-9:high" });
		expect(result.model.id).toBe("claude-sonnet-9");
		expect(result.thinking).toBe("high");
		expect(result.warning).toBeUndefined();
	});

	it("throws ModelAuthError naming the login command and env var when the configured provider has no auth", async () => {
		const { runtime } = stubRuntime({ models, authed: [] });
		const err = await resolveModel({ runtime, configured: "openai/gpt-9-mini" }).catch((e) => e);
		expect(err).toBeInstanceOf(ModelAuthError);
		expect(err.message).toBe(
			"Model openai/gpt-9-mini needs credentials for openai. Run `gribble login openai` or set OPENAI_API_KEY.",
		);
		expect(err.envVar).toBe("OPENAI_API_KEY");
	});

	it("throws UnknownModelError for a spec that is not in the catalog", async () => {
		const { runtime } = stubRuntime({ models, authed: ["anthropic"] });
		await expect(
			resolveModel({ runtime, configured: "anthropic/does-not-exist-xyz" }),
		).rejects.toBeInstanceOf(UnknownModelError);
	});

	it("falls back from the settings model to the first available model with a warning", async () => {
		const { runtime } = stubRuntime({ models, authed: ["openai"] });
		const result = await resolveModel({ runtime, settingsModel: "anthropic/claude-sonnet-9" });
		expect(result.model.provider).toBe("openai");
		expect(result.warning).toMatch(/needs credentials.*Using openai\/gpt-9-mini instead/);
	});

	it("prefers recommended models when nothing is configured, and errors when nothing is available", async () => {
		const { runtime } = stubRuntime({ models, authed: ["acme", "openai"] });
		const result = await resolveModel({ runtime });
		expect(result.model.provider).toBe("openai");
		expect(result.warning).toMatch(/No model configured/);
		const { runtime: empty } = stubRuntime({ models, authed: [] });
		await expect(resolveModel({ runtime: empty })).rejects.toBeInstanceOf(NoModelError);
	});
});

describe("loginProvider", () => {
	const interaction: AuthInteraction = {
		prompt: vi.fn(async () => "typed-by-user"),
		notify: vi.fn(),
	};

	it("answers the secret prompt with the given API key", async () => {
		const { runtime, login } = stubRuntime({ models, authed: [] });
		await loginProvider({ runtime, provider: "openai", apiKey: " sk-test ", interaction });
		expect(login).toHaveBeenCalledWith("openai", "api_key", expect.anything());
		expect(await login.mock.results[0]?.value).toEqual({ type: "api_key", key: "sk-test" });
		expect(interaction.prompt).not.toHaveBeenCalled();
	});

	it("runs the OAuth flow when no key is given and the provider supports it, else the api-key prompt", async () => {
		const { runtime, login } = stubRuntime({ models, authed: [], oauth: ["anthropic"] });
		await loginProvider({ runtime, provider: "anthropic", interaction });
		expect(login).toHaveBeenLastCalledWith("anthropic", "oauth", interaction);
		expect(interaction.notify).toHaveBeenCalledWith({ type: "auth_url", url: "https://example.com/oauth" });
		await loginProvider({ runtime, provider: "openai", interaction });
		expect(login).toHaveBeenLastCalledWith("openai", "api_key", interaction);
		await expect(loginProvider({ runtime, provider: "nope", interaction })).rejects.toThrow(
			/Unknown provider/,
		);
	});
});

describe("listProviders / providerEnvVar / usageFromMessages", () => {
	it("lists providers with auth status, configured first", () => {
		const { runtime } = stubRuntime({ models, authed: ["openai"], oauth: ["anthropic"] });
		const list = listProviders(runtime);
		expect(list.map((p) => p.id)).toEqual(["openai", "acme", "anthropic"]);
		expect(list[0]).toMatchObject({
			auth: { configured: true, source: "environment" },
			envVar: "OPENAI_API_KEY",
			oauth: false,
		});
		expect(list[2]).toMatchObject({ oauth: true, apiKeyLogin: true });
	});

	it("knows the env var convention", () => {
		expect(providerEnvVar("google")).toBe("GEMINI_API_KEY");
		expect(providerEnvVar("some-proxy")).toBe("SOME_PROXY_API_KEY");
	});

	it("sums usage over assistant messages and counts tool calls as steps", () => {
		const usage = (total: number, cost: number) => ({
			input: total - 5,
			output: 5,
			cacheRead: 1,
			cacheWrite: 0,
			totalTokens: total,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
		});
		const messages = [
			{ role: "user", content: "hi", timestamp: 1 },
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "1", name: "navigate", arguments: {} }],
				usage: usage(100, 0.01),
				stopReason: "toolUse",
				api: "x",
				provider: "p",
				model: "m",
				timestamp: 2,
			},
			{
				role: "toolResult",
				toolCallId: "1",
				toolName: "navigate",
				content: [],
				isError: false,
				timestamp: 3,
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "done" }],
				usage: usage(250, 0.02),
				stopReason: "stop",
				api: "x",
				provider: "p",
				model: "m",
				timestamp: 4,
			},
		] as unknown as AgentMessage[];
		expect(usageFromMessages(messages)).toEqual({
			tokens: 350,
			input: 340,
			output: 10,
			cacheRead: 2,
			cacheWrite: 0,
			costUsd: 0.03,
			turns: 2,
			steps: 1,
		});
	});
});
