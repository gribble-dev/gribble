import { copy } from "../copy.js";
import { CliError, EXIT } from "../errors.js";
import type { CommandContext } from "./context.js";

export interface InstallOptions {
	withDeps?: boolean;
}

/** `gribble install`: runs Playwright's `install chromium`, stdio inherited. */
export async function runInstall(opts: InstallOptions, ctx: CommandContext): Promise<number> {
	const { ui, deps } = ctx;
	ui.line(copy.install.starting);
	const code = await deps.installBrowser({ withDeps: opts.withDeps === true, context: deps.context });
	if (code === -1) throw new CliError(copy.install.notFound, { exitCode: EXIT.config });
	if (code !== 0) throw new CliError(copy.install.failed(code), { exitCode: EXIT.config });
	ui.line(`${ui.colors.green("✓")} ${copy.install.done}`);
	return EXIT.ok;
}
