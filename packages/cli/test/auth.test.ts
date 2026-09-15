import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createAuthInteraction } from "../src/auth-interaction.js";
import { run } from "../src/index.js";
import { clackPrompter } from "../src/prompts.js";
import { fakeRuntime, scriptedPrompter, testIo } from "./helpers.js";

describe("login / logout / models", () => {
	it("login with --api-key skips every prompt", async () => {
		const io = testIo();
		const runtime = fakeRuntime({ providers: [{ id: "openai", name: "OpenAI" }] });
		const seen: Array<{ provider: string; apiKey?: string }> = [];
		const code = await run(["login", "openai", "--api-key", "sk-1"], {
			context: io.context,
			createModelRuntime: async () => runtime,
			loginProvider: async ({ provider, apiKey }) => {
				seen.push({ provider, apiKey });
			},
		});
		expect(code).toBe(0);
		expect(seen).toEqual([{ provider: "openai", apiKey: "sk-1" }]);
		expect(io.stdout.text).toContain("Logged in to OpenAI");
		expect(io.stdout.text).toContain("shell history");
	});

	it("login rejects an unknown provider with exit 2 and lists the known ones", async () => {
		const io = testIo();
		const code = await run(["login", "nope", "--api-key", "k"], {
			context: io.context,
			createModelRuntime: async () => fakeRuntime({ providers: [{ id: "openai" }, { id: "google" }] }),
		});
		expect(code).toBe(2);
		expect(io.stderr.text).toContain('Unknown provider "nope". Known providers: google, openai.');
	});

	it("interactive OAuth login runs through the AuthInteraction and opens the browser", async () => {
		const io = testIo({ isTTY: true });
		const prompter = scriptedPrompter([{ select: "Anthropic" }, { select: "oauth" }, { text: "code-123" }]);
		const runtime = fakeRuntime({
			providers: [{ id: "anthropic", name: "Anthropic", oauth: true, oauthLabel: "Claude Pro/Max" }],
		});
		const opened: string[] = [];
		const code = await run(["login"], {
			context: io.context,
			createModelRuntime: async () => runtime,
			prompter: () => prompter,
			openBrowser: (url) => opened.push(url),
			loginProvider: async ({ provider, apiKey, interaction }) => {
				expect(provider).toBe("anthropic");
				expect(apiKey).toBeUndefined();
				interaction.notify({
					type: "auth_url",
					url: "https://example.test/auth",
					instructions: "then paste the code",
				});
				const answer = await interaction.prompt({ type: "manual_code", message: "Paste the code" });
				expect(answer).toBe("code-123");
			},
		});
		expect(code).toBe(0);
		expect(opened).toEqual(["https://example.test/auth"]);
		expect(prompter.log).toContain(
			"[info] Opening your browser to continue. If nothing opens, use this URL:\nhttps://example.test/auth\nthen paste the code",
		);
		expect(prompter.log).toContain("[success] Logged in to Anthropic. The gribbles have a brain now.");
	});

	it("AuthInteraction without an opener only prints the auth URL", () => {
		const prompter = scriptedPrompter([]);
		const interaction = createAuthInteraction(prompter);
		interaction.notify({ type: "auth_url", url: "https://example.test/auth" });
		expect(prompter.log).toContain(
			"[info] Open this URL in your browser to continue:\nhttps://example.test/auth",
		);
	});

	it("AuthInteraction maps every prompt and event kind", async () => {
		const prompter = scriptedPrompter([{ text: "t" }, { secret: "s" }, { select: "b" }, { text: "m" }]);
		const interaction = createAuthInteraction(prompter);
		expect(await interaction.prompt({ type: "text", message: "text?" })).toBe("t");
		expect(await interaction.prompt({ type: "secret", message: "secret?" })).toBe("s");
		expect(
			await interaction.prompt({
				type: "select",
				message: "pick",
				options: [
					{ id: "a", label: "A" },
					{ id: "b", label: "B", description: "second" },
				],
			}),
		).toBe("b");
		expect(await interaction.prompt({ type: "manual_code", message: "code?" })).toBe("m");
		interaction.notify({ type: "info", message: "hello", links: [{ url: "https://x.test", label: "docs" }] });
		interaction.notify({
			type: "device_code",
			userCode: "ABCD-1234",
			verificationUri: "https://v.test",
			expiresInSeconds: 600,
		});
		interaction.notify({ type: "progress", message: "waiting" });
		expect(prompter.log).toContain("[info] hello\ndocs: https://x.test");
		expect(prompter.log).toContain(
			"[note] Visit https://v.test and enter the code ABCD-1234\nThe code expires in 10 minutes.",
		);
		expect(prompter.log).toContain("[step] waiting");
	});

	it("AuthInteraction forwards pi's abort signal so a won race abandons the paste prompt", async () => {
		// pi's OAuth flows race a manual_code prompt against a localhost callback server and abort
		// the prompt when the browser redirect wins. The prompter must see that signal, or the
		// prompt keeps stdin open and the CLI never exits after a successful login.
		const seen: Array<AbortSignal | undefined> = [];
		const prompter = scriptedPrompter([{ text: "" }, { secret: "" }, { select: "a" }]);
		const base = prompter.text;
		prompter.text = async (o) => {
			seen.push(o.signal);
			return base(o);
		};
		const baseSecret = prompter.secret;
		prompter.secret = async (o) => {
			seen.push(o.signal);
			return baseSecret(o);
		};
		const baseSelect = prompter.select;
		prompter.select = async (o) => {
			seen.push(o.signal);
			return baseSelect(o);
		};
		const interaction = createAuthInteraction(prompter);
		const controller = new AbortController();
		await interaction.prompt({ type: "manual_code", message: "paste", signal: controller.signal });
		await interaction.prompt({ type: "secret", message: "key", signal: controller.signal });
		await interaction.prompt({
			type: "select",
			message: "pick",
			options: [{ id: "a", label: "A" }],
			signal: controller.signal,
		});
		expect(seen).toEqual([controller.signal, controller.signal, controller.signal]);
	});

	it("clackPrompter cancels an open text prompt when its signal aborts", async () => {
		const output = new PassThrough();
		const input = new PassThrough();
		const prompter = clackPrompter(output, { cancelledMessage: "gone", input });
		const controller = new AbortController();
		const pending = prompter.text({ message: "paste", signal: controller.signal });
		controller.abort();
		await expect(pending).rejects.toThrow("gone");
	});

	it("logout removes one or every stored credential", async () => {
		const one = testIo();
		const runtime = fakeRuntime({ stored: ["openai", "google"] });
		expect(
			await run(["logout", "openai"], { context: one.context, createModelRuntime: async () => runtime }),
		).toBe(0);
		expect(runtime.loggedOut).toEqual(["openai"]);
		expect(one.stdout.text).toContain("Removed credentials for openai.");

		const all = testIo();
		expect(await run(["logout"], { context: all.context, createModelRuntime: async () => runtime })).toBe(0);
		expect(runtime.loggedOut).toEqual(["openai", "google"]);
		expect(all.stdout.text).toContain("Removed credentials for 1 provider.");

		const none = testIo();
		expect(await run(["logout"], { context: none.context, createModelRuntime: async () => runtime })).toBe(0);
		expect(none.stdout.text).toContain("No stored credentials.");
	});

	it("models lists reachable models recommended first", async () => {
		const io = testIo();
		const runtime = fakeRuntime({
			models: [
				{ provider: "other", id: "plain-model" },
				{ provider: "anthropic", id: "claude-sonnet-4-5" },
			],
			providers: [
				{ id: "other", configured: true, source: "OTHER_API_KEY" },
				{ id: "anthropic", configured: true, source: "ANTHROPIC_API_KEY" },
			],
		});
		expect(await run(["models"], { context: io.context, createModelRuntime: async () => runtime })).toBe(0);
		const lines = io.stdout.text.split("\n").filter((l) => l.includes("/"));
		expect(lines[0]).toContain("★ anthropic/claude-sonnet-4-5");
		expect(lines[0]).toContain("ANTHROPIC_API_KEY");
		expect(lines[1]).toContain("other/plain-model");
		expect(lines[1]).not.toContain("★");

		const empty = testIo();
		expect(
			await run(["models"], { context: empty.context, createModelRuntime: async () => fakeRuntime({}) }),
		).toBe(0);
		expect(empty.stdout.text).toContain("No models within reach.");
	});
});
