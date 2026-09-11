import { EXIT } from "../errors.js";
import type { CommandContext } from "./context.js";

export function runVersion(ctx: CommandContext): number {
	ctx.ui.stdout.write(`${ctx.deps.version}\n`);
	return EXIT.ok;
}
