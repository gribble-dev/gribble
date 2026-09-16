import { loadPiCodingAgent } from "@gribble/core";

/** Default model from `<agentDir>/settings.json` in pi syntax, when both provider and model are set. */
export type ReadSettingsModel = (opts: { cwd: string; agentDir: string }) => Promise<string | undefined>;

export const readSettingsModel: ReadSettingsModel = async ({ cwd, agentDir }) => {
	try {
		const { SettingsManager } = await loadPiCodingAgent();
		const settings = SettingsManager.create(cwd, agentDir);
		const provider = settings.getDefaultProvider();
		const model = settings.getDefaultModel();
		settings.drainErrors();
		if (!provider || !model) return undefined;
		const thinking = settings.getDefaultThinkingLevel();
		return `${provider}/${model}${thinking ? `:${thinking}` : ""}`;
	} catch {
		return undefined;
	}
};
