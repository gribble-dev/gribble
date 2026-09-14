import { createAuthInteraction } from "../auth-interaction.js";
import { copy } from "../copy.js";
import { CliError, EXIT } from "../errors.js";
import { projectAgentDir } from "../project-agent-dir.js";
import type { ProviderInfo, RuntimeLike } from "../providers.js";
import type { CommandContext } from "./context.js";

export interface LoginOptions {
	apiKey?: string;
	/** Agent dir override; defaults to `gribbleAgentDir()` (GRIBBLE_HOME aware). */
	agentDir?: string;
}

/**
 * Interactive login for one provider. Shared with `gribble init`, which calls it when no
 * credentials are found. Returns the provider id that was logged in to.
 */
export async function loginFlow(
	ctx: CommandContext,
	runtime: RuntimeLike,
	opts: { provider?: string; apiKey?: string },
): Promise<string> {
	const { deps, prompter, ui } = ctx;
	const providers = await deps.listProviders(runtime);
	if (providers.length === 0) throw new CliError(copy.login.noProviders, { exitCode: EXIT.config });

	let provider: ProviderInfo | undefined;
	if (opts.provider) {
		provider = providers.find(
			(p) => p.id === opts.provider || p.name.toLowerCase() === opts.provider?.toLowerCase(),
		);
		if (!provider) {
			throw new CliError(
				copy.login.unknownProvider(
					opts.provider,
					providers.map((p) => p.id),
				),
				{ exitCode: EXIT.config },
			);
		}
	} else {
		if (!ui.interactive) throw new CliError(copy.login.ciNoPrompt, { exitCode: EXIT.config });
		const loginable = providers.filter((p) => p.apiKey || p.oauth);
		provider = await prompter.select<ProviderInfo>({
			message: copy.login.pickProvider,
			options: loginable.map((p) => ({
				value: p,
				label: p.name,
				hint: p.configured
					? copy.login.configuredHint(p.source ?? "stored credentials")
					: copy.login.notConfiguredHint,
			})),
		});
	}

	let apiKey = opts.apiKey;
	if (!apiKey) {
		if (!ui.interactive) throw new CliError(copy.login.ciNoPrompt, { exitCode: EXIT.config });
		let method: "oauth" | "api_key";
		if (provider.oauth && provider.apiKey) {
			method = await prompter.select<"oauth" | "api_key">({
				message: copy.login.pickMethod(provider.name),
				options: [
					{ value: "oauth", label: provider.oauthLabel ?? copy.login.methodOAuth },
					{ value: "api_key", label: copy.login.methodApiKey },
				],
			});
		} else {
			method = provider.oauth ? "oauth" : "api_key";
		}
		if (method === "api_key") {
			apiKey = await prompter.secret({ message: copy.login.askApiKey(provider.name) });
			if (!apiKey.trim()) throw new CliError(copy.login.cancelled, { exitCode: EXIT.cancelled });
		}
	}

	const interaction = createAuthInteraction(prompter, { signal: deps.context.signal });
	prompter.step(copy.login.working(provider.name));
	await deps.loginProvider({ runtime, provider: provider.id, apiKey: apiKey?.trim(), interaction });
	prompter.success(copy.login.done(provider.name));
	return provider.id;
}

export async function runLogin(
	providerArg: string | undefined,
	opts: LoginOptions,
	ctx: CommandContext,
): Promise<number> {
	const { deps, ui } = ctx;
	const env = deps.context.env;
	if (opts.apiKey) ui.line(ui.colors.dim(copy.login.apiKeyInHistory));
	const agentDir = await projectAgentDir(deps, opts.agentDir);
	const runtime = await deps.createModelRuntime({ agentDir, env });
	await loginFlow(ctx, runtime, { provider: providerArg, apiKey: opts.apiKey });
	return EXIT.ok;
}
