import type { CliDeps } from "./deps.js";

/**
 * The global agent dir for commands that run outside `audit`. When the current directory belongs to
 * a project whose gribble.yaml sets `reusePiAuth`, honor it so `models`, `login` and `logout` look at
 * the same credentials the audit will use.
 */
export async function projectAgentDir(deps: CliDeps, override?: string): Promise<string> {
	if (override) return override;
	const env = deps.context.env;
	let reusePiAuth: boolean | undefined;
	try {
		const project = await deps.loadProject({ cwd: deps.context.cwd, env });
		reusePiAuth = project.config.reusePiAuth;
	} catch {
		// Not inside a Gribble project: fall back to the global directory.
	}
	return deps.gribbleAgentDir({ reusePiAuth, env });
}
