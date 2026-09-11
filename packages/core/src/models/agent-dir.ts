import { homedir } from "node:os";
import { join } from "node:path";

export const GRIBBLE_HOME_ENV = "GRIBBLE_HOME";
export const PI_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

/**
 * Directory that holds settings.json, auth.json and models.json.
 * `~/.gribble` by default; `GRIBBLE_HOME` overrides it. With `reusePiAuth` the pi agent
 * directory is used instead (`~/.pi/agent`, or `PI_CODING_AGENT_DIR`).
 */
export function gribbleAgentDir(opts: { reusePiAuth?: boolean; env?: NodeJS.ProcessEnv } = {}): string {
	const env = opts.env ?? process.env;
	if (opts.reusePiAuth) {
		return env[PI_AGENT_DIR_ENV] || join(homedir(), ".pi", "agent");
	}
	return env[GRIBBLE_HOME_ENV] || join(homedir(), ".gribble");
}

/** Files inside the agent directory that Gribble reads or writes. */
export function agentDirFiles(agentDir: string): {
	settings: string;
	auth: string;
	models: string;
	modelsStore: string;
} {
	return {
		settings: join(agentDir, "settings.json"),
		auth: join(agentDir, "auth.json"),
		models: join(agentDir, "models.json"),
		modelsStore: join(agentDir, "models-store.json"),
	};
}
