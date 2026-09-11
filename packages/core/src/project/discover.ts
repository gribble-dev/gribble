import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import fg from "fast-glob";
import { parse as parseYaml } from "yaml";
import { isPlainObject } from "../util/index.js";

export const GRIBBLE_DIR_NAME = ".gribble";

const IGNORED = [
	"**/node_modules/**",
	"**/.git/**",
	"**/dist/**",
	"**/build/**",
	"**/.svelte-kit/**",
	"**/.next/**",
];

/**
 * Find every `.gribble/` directory under `root` whose gribble.yaml declares a `target`
 * (shared-only root directories are skipped). Returns absolute paths of the `.gribble` directories, sorted.
 */
export async function findGribbleDirs(root: string): Promise<string[]> {
	const files = await fg(`**/${GRIBBLE_DIR_NAME}/gribble.yaml`, {
		cwd: root,
		absolute: true,
		dot: true,
		ignore: IGNORED,
	});
	const dirs: string[] = [];
	for (const file of files.sort()) {
		let hasTarget = true;
		try {
			const raw = parseYaml(await readFile(file, "utf8"));
			hasTarget = isPlainObject(raw) && raw.target !== undefined && raw.target !== null;
		} catch {
			// unparsable files still count: loadProject will report the real error
		}
		if (hasTarget) dirs.push(resolve(dirname(file)));
	}
	return dirs;
}
