import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

/** What the CLI needs to know about a provider to list it and offer a login. */
export interface ProviderInfo {
	id: string;
	name: string;
	/** Credentials are complete: stored, runtime, or environment. */
	configured: boolean;
	/** Where the credentials came from, e.g. `ANTHROPIC_API_KEY`, `OAuth`. */
	source?: string;
	/** Provider offers an interactive API key login. */
	apiKey: boolean;
	/** Provider offers an OAuth (subscription) login. */
	oauth: boolean;
	/** Label for the OAuth option, when the provider names one. */
	oauthLabel?: string;
}

/** The subset of pi's `ModelRuntime` the CLI touches. Tests pass a plain object. */
export type RuntimeLike = Pick<
	ModelRuntime,
	"getProviders" | "getAvailable" | "checkAuth" | "logout" | "listCredentials" | "getModel"
> &
	Partial<Pick<ModelRuntime, "getProviderAuthStatus">>;

/**
 * List providers with their auth state, straight from pi's runtime. core-agent may export an
 * equivalent `listProviders` from @gribble/core; this version keeps the CLI independent of it.
 */
export async function listProviders(runtime: RuntimeLike): Promise<ProviderInfo[]> {
	const out: ProviderInfo[] = [];
	for (const provider of runtime.getProviders()) {
		let configured = false;
		let source: string | undefined;
		try {
			const check = await runtime.checkAuth(provider.id);
			if (check) {
				configured = true;
				source = check.source ?? (check.type === "oauth" ? "OAuth" : undefined);
			}
		} catch {
			configured = false;
		}
		if (!configured && runtime.getProviderAuthStatus) {
			try {
				const status = runtime.getProviderAuthStatus(provider.id);
				if (status.configured) {
					configured = true;
					source = status.label ?? status.source;
				}
			} catch {
				// keep unconfigured
			}
		}
		out.push({
			id: provider.id,
			name: provider.name || provider.id,
			configured,
			source,
			apiKey: typeof provider.auth.apiKey?.login === "function",
			oauth: provider.auth.oauth !== undefined,
			oauthLabel: provider.auth.oauth?.loginLabel,
		});
	}
	return out.sort((a, b) => Number(b.configured) - Number(a.configured) || a.name.localeCompare(b.name));
}

export type ListProviders = (runtime: RuntimeLike) => Promise<ProviderInfo[]>;
