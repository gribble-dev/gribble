import { access, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { ConfigError } from "../config/errors.js";
import {
	GRIBBLE_CONFIG_FILE,
	parseGribbleConfig,
	parseRulesConfig,
	RULES_CONFIG_FILE,
} from "../config/parse.js";
import { resolveRules } from "../config/resolve.js";
import type { RulesConfig } from "../config/types.js";
import { loadFlows } from "../flows/load.js";
import { GRIBBLE_DIR_NAME } from "./discover.js";
import type { ProjectContext } from "./types.js";

export const GUIDELINES_FILE = "guidelines.md";

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function readIfExists(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw err;
	}
}

/** Walk up from `dir` to the nearest directory containing `.git`; undefined when there is none. */
export async function findRepoRoot(dir: string): Promise<string | undefined> {
	let current = resolve(dir);
	for (;;) {
		if (await exists(join(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

function toPosix(path: string): string {
	return path.split(sep).join("/");
}

/** Directories from `root` down to `dir` (inclusive at both ends). Empty when `dir` is outside `root`. */
function chain(root: string, dir: string): string[] {
	const rel = relative(root, dir);
	if (rel.startsWith("..") || resolve(root, rel) !== resolve(dir)) return [];
	const out = [root];
	let current = root;
	for (const segment of rel.split(sep).filter(Boolean)) {
		current = join(current, segment);
		out.push(current);
	}
	return out;
}

/**
 * Load the project for `target` (relative to `cwd`, default `.`): its gribble.yaml plus the cascade of
 * `.gribble/rules.yaml` and `.gribble/guidelines.md` found in ancestor directories up to the repo root.
 * Rules merge root-first, child-last; guidelines are concatenated root-first.
 */
export async function loadProject(opts: {
	cwd: string;
	target?: string;
	environment?: string;
	env?: NodeJS.ProcessEnv;
}): Promise<ProjectContext> {
	const targetDir = resolve(opts.cwd, opts.target ?? ".");
	const gribbleDir = join(targetDir, GRIBBLE_DIR_NAME);
	const configPath = join(gribbleDir, GRIBBLE_CONFIG_FILE);
	const configText = await readIfExists(configPath);
	if (configText === undefined) {
		throw new ConfigError(
			`no ${GRIBBLE_DIR_NAME}/${GRIBBLE_CONFIG_FILE} in ${targetDir}. Run \`gribble init\` there, or pass --target <dir>.`,
			{ file: configPath },
		);
	}
	const repoRoot = (await findRepoRoot(targetDir)) ?? resolve(opts.cwd);
	const targetName = toPosix(relative(repoRoot, targetDir));

	const config = parseGribbleConfig(configText, {
		env: opts.env,
		environment: opts.environment,
		file: toPosix(relative(repoRoot, configPath)) || configPath,
	});

	const dirs = chain(repoRoot, targetDir);
	const levels = dirs.length > 0 ? dirs : [targetDir];
	const rulesConfigs: RulesConfig[] = [];
	const guidelineParts: string[] = [];
	const cascade: string[] = [];
	for (const dir of levels) {
		const levelGribbleDir = join(dir, GRIBBLE_DIR_NAME);
		if (!(await exists(levelGribbleDir))) continue;
		cascade.push(levelGribbleDir);
		const rulesPath = join(levelGribbleDir, RULES_CONFIG_FILE);
		const rulesText = await readIfExists(rulesPath);
		if (rulesText !== undefined) {
			rulesConfigs.push(
				parseRulesConfig(rulesText, { file: toPosix(relative(repoRoot, rulesPath)) || rulesPath }),
			);
		}
		const guidelinesPath = join(levelGribbleDir, GUIDELINES_FILE);
		const guidelines = (await readIfExists(guidelinesPath))?.trim();
		if (guidelines) {
			const source = toPosix(relative(repoRoot, guidelinesPath)) || guidelinesPath;
			guidelineParts.push(`<!-- guidelines: ${source} -->\n${guidelines}`);
		}
	}

	const flows = await loadFlows(gribbleDir);
	// `environments.<name>.rules` is applied after the whole cascade, so a preview deployment can
	// switch a rule off without touching rules.yaml for production.
	const environmentRules = opts.environment ? config.environments?.[opts.environment]?.rules : undefined;
	const environment =
		opts.environment && environmentRules ? { name: opts.environment, rules: environmentRules } : undefined;
	return {
		repoRoot,
		targetDir,
		gribbleDir,
		targetName,
		config,
		rules: resolveRules(rulesConfigs, { environment }),
		guidelines: guidelineParts.join("\n\n"),
		flows,
		environment: opts.environment,
		cascade,
	};
}
