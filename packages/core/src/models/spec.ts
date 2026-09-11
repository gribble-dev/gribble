import type { ThinkingLevel } from "@earendil-works/pi-ai";

const THINKING_LEVELS: ReadonlySet<string> = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);

export interface ModelSpec {
	provider: string;
	id: string;
	thinking?: ThinkingLevel;
}

/**
 * Parse pi's `provider/id[:thinking]` syntax. The id may itself contain slashes
 * (`openrouter/anthropic/claude-x`); only the first slash separates the provider.
 * Returns undefined when there is no provider part.
 */
export function parseModelSpec(spec: string): ModelSpec | undefined {
	const trimmed = spec.trim();
	const slash = trimmed.indexOf("/");
	if (slash <= 0) return undefined;
	const provider = trimmed.slice(0, slash);
	let id = trimmed.slice(slash + 1);
	let thinking: ThinkingLevel | undefined;
	const colon = id.lastIndexOf(":");
	if (colon > 0) {
		const suffix = id.slice(colon + 1);
		if (THINKING_LEVELS.has(suffix)) {
			thinking = suffix as ThinkingLevel;
			id = id.slice(0, colon);
		}
	}
	if (!id) return undefined;
	return thinking ? { provider, id, thinking } : { provider, id };
}

export function formatModelSpec(spec: ModelSpec): string {
	return `${spec.provider}/${spec.id}${spec.thinking ? `:${spec.thinking}` : ""}`;
}
