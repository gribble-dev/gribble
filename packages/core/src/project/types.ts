import type { ResolvedRules } from "../config/resolve.js";
import type { GribbleConfig } from "../config/types.js";
import type { Flow } from "../flows/schema.js";

export interface ProjectContext {
	/** Git root, or the cwd when the target is not inside a git repository. */
	repoRoot: string;
	/** Directory that contains the `.gribble/` of the audited app. */
	targetDir: string;
	/** `${targetDir}/.gribble` */
	gribbleDir: string;
	/** "" for a single-app repo, otherwise the path relative to the repo root, e.g. `apps/web`. */
	targetName: string;
	config: GribbleConfig;
	rules: ResolvedRules;
	/** Concatenated guidelines.md files, root first, each preceded by a comment naming its source. */
	guidelines: string;
	flows: Flow[];
	environment?: string;
	/** Absolute paths of every `.gribble/` directory that contributed to the cascade, root first. */
	cascade: string[];
}
