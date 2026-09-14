import { copy } from "../copy.js";
import { EXIT } from "../errors.js";
import { projectAgentDir } from "../project-agent-dir.js";
import type { CommandContext } from "./context.js";

export interface ModelsOptions {
	agentDir?: string;
}

/** `gribble models`: reachable models, recommended first, with auth source and a note. */
export async function runModels(opts: ModelsOptions, ctx: CommandContext): Promise<number> {
	const { deps, ui } = ctx;
	const c = ui.colors;
	const env = deps.context.env;
	const agentDir = await projectAgentDir(deps, opts.agentDir);
	const runtime = await deps.createModelRuntime({ agentDir, env });
	const available = deps.rankModels([...(await runtime.getAvailable())]);
	if (available.length === 0) {
		ui.line(copy.models.none);
		return EXIT.ok;
	}
	const providers = await deps.listProviders(runtime);
	const sourceOf = new Map(providers.map((p) => [p.id, p.source]));

	ui.line(copy.models.header(available.length));
	ui.line();
	const specWidth = Math.min(48, Math.max(...available.map((m) => `${m.provider}/${m.id}`.length)));
	for (const model of available) {
		const rec = deps.recommendationFor(model);
		const spec = `${model.provider}/${model.id}`.padEnd(specWidth);
		const mark = rec ? c.yellow(copy.models.recommendedMark) : " ";
		const source = sourceOf.get(model.provider);
		const auth = c.dim((source ?? "configured").padEnd(22));
		const note = rec ? c.dim(rec.note) : "";
		ui.line(`  ${mark} ${rec ? c.bold(spec) : spec}  ${auth} ${note}`.trimEnd());
	}
	ui.line();
	ui.line(c.dim(copy.models.hint));
	return EXIT.ok;
}
