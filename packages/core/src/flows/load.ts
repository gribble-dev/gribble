import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import fg from "fast-glob";
import { parseFlow, parseFlowReplay } from "./parse.js";
import type { Flow } from "./schema.js";

export const FLOWS_DIR = "flows";

async function exists(file: string): Promise<boolean> {
	try {
		await access(file);
		return true;
	} catch {
		return false;
	}
}

/** Sidecar path for a flow file: `flows/checkout.md` -> `flows/checkout.replay.json`. */
export function replaySidecarPath(flowFile: string): string {
	return join(dirname(flowFile), `${flowFile.split(/[\\/]/).pop()?.replace(/\.md$/i, "")}.replay.json`);
}

/**
 * Load every `flows/**\/*.md` under `gribbleDir` (README.md files excluded), sorted by path,
 * and attach the `<name>.replay.json` sidecar when present.
 */
export async function loadFlows(gribbleDir: string): Promise<Flow[]> {
	const flowsDir = join(gribbleDir, FLOWS_DIR);
	if (!(await exists(flowsDir))) return [];
	const found = await fg("**/*.md", {
		cwd: flowsDir,
		absolute: true,
		ignore: ["**/README.md", "**/readme.md"],
	});
	const files = found.map((f) => resolve(f)).sort();
	const flows: Flow[] = [];
	for (const file of files) {
		const flow = parseFlow(file, await readFile(file, "utf8"));
		const sidecar = replaySidecarPath(file);
		if (await exists(sidecar)) {
			flow.replay = parseFlowReplay(sidecar, await readFile(sidecar, "utf8"));
		}
		flows.push(flow);
	}
	return flows;
}
