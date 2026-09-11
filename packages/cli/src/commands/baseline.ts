import type { AuditMode } from "@gribble/core";
import { runAuditCommand } from "./audit.js";
import type { CommandContext } from "./context.js";

export interface BaselineUpdateOptions {
	mode?: AuditMode;
	target?: string;
	all?: boolean;
	env?: string;
	json?: boolean;
	ci?: boolean;
}

/** `gribble baseline update`: a gate audit that writes `.gribble/baseline/`. Never commits. */
export function runBaselineUpdate(opts: BaselineUpdateOptions, ctx: CommandContext): Promise<number> {
	return runAuditCommand(
		{
			mode: opts.mode ?? "gate",
			target: opts.target,
			all: opts.all,
			env: opts.env,
			json: opts.json,
			ci: opts.ci,
			updateBaseline: true,
		},
		ctx,
	);
}
