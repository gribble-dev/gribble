import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { GRIBBLE_CONFIG_FILE, GRIBBLE_DIR_NAME } from "@gribble/core";

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * The nearest directory at or above `from` that holds a `.gribble/gribble.yaml`, or undefined when
 * there is none: commands that work both inside and outside a project use it to tell the two apart.
 */
export async function findProjectDir(from: string): Promise<string | undefined> {
	let current = resolve(from);
	for (;;) {
		if (await exists(join(current, GRIBBLE_DIR_NAME, GRIBBLE_CONFIG_FILE))) return current;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}
