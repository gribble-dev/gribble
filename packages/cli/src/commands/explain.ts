import { EXIT } from "../errors.js";
import type { CommandContext } from "./context.js";

/** `gribble explain <rule>`: prints the registry entry. Unknown rules print the hint and exit 2. */
export function runExplain(ruleId: string, ctx: CommandContext): number {
	const { deps, ui } = ctx;
	ui.line(deps.explainRule(ruleId));
	return deps.getRule(ruleId) ? EXIT.ok : EXIT.config;
}
