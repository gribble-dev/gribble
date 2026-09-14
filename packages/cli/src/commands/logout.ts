import { copy } from "../copy.js";
import { EXIT } from "../errors.js";
import { projectAgentDir } from "../project-agent-dir.js";
import type { CommandContext } from "./context.js";

export interface LogoutOptions {
	agentDir?: string;
}

/** `gribble logout [provider]`: removes stored credentials; environment variables are untouched. */
export async function runLogout(
	providerArg: string | undefined,
	opts: LogoutOptions,
	ctx: CommandContext,
): Promise<number> {
	const { deps, ui } = ctx;
	const env = deps.context.env;
	const agentDir = await projectAgentDir(deps, opts.agentDir);
	const runtime = await deps.createModelRuntime({ agentDir, env });
	const stored = await runtime.listCredentials();
	if (providerArg) {
		if (!stored.some((c) => c.providerId === providerArg)) {
			ui.line(copy.logout.notStored(providerArg));
			return EXIT.ok;
		}
		await runtime.logout(providerArg);
		ui.line(copy.logout.removed(providerArg));
		return EXIT.ok;
	}
	if (stored.length === 0) {
		ui.line(copy.logout.nothingStored);
		return EXIT.ok;
	}
	for (const credential of stored) await runtime.logout(credential.providerId);
	ui.line(copy.logout.removedAll(stored.length));
	return EXIT.ok;
}
