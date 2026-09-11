import { promises as fs } from "node:fs";
import path from "node:path";
import { DefaultArtifactClient } from "@actions/artifact";
import * as core from "@actions/core";
import { errorMessage } from "./github.js";
import { findLatestRunDir } from "./report.js";
import type { LoadedReport } from "./types.js";

export const ARTIFACT_NAME = "gribble-report";

async function listFiles(dir: string): Promise<string[]> {
	const out: string[] = [];
	async function walk(current: string): Promise<void> {
		const entries = await fs.readdir(current, { withFileTypes: true });
		for (const e of entries) {
			const full = path.join(current, e.name);
			if (e.isDirectory()) await walk(full);
			else if (e.isFile()) out.push(full);
		}
	}
	try {
		await walk(dir);
	} catch {
		// missing directory: nothing to upload
	}
	return out;
}

export interface ArtifactUpload {
	id?: number;
	url?: string;
	files: number;
}

/**
 * Upload each target's latest run directory (report, screenshots, snapshots,
 * traces) plus the generated SARIF/JUnit files as one `gribble-report` artifact.
 */
export async function uploadReportArtifact(opts: {
	loaded: LoadedReport[];
	extraFiles: string[];
	rootDirectory: string;
	serverUrl: string;
	repo: { owner: string; repo: string };
	runId: number;
}): Promise<ArtifactUpload | undefined> {
	const files = new Set<string>();
	for (const l of opts.loaded) {
		files.add(l.path);
		const runDir = await findLatestRunDir(l.gribbleDir);
		if (runDir) for (const f of await listFiles(runDir)) files.add(f);
	}
	for (const f of opts.extraFiles) files.add(f);
	const list = [...files].filter((f) => !path.relative(opts.rootDirectory, f).startsWith(".."));
	if (list.length === 0) {
		core.info("Nothing to upload as an artifact.");
		return undefined;
	}
	try {
		const client = new DefaultArtifactClient();
		const res = await client.uploadArtifact(ARTIFACT_NAME, list, opts.rootDirectory, { retentionDays: 30 });
		const id = res.id;
		const url = id
			? `${opts.serverUrl}/${opts.repo.owner}/${opts.repo.repo}/actions/runs/${opts.runId}/artifacts/${id}`
			: undefined;
		core.info(`Uploaded ${list.length} file(s) as artifact "${ARTIFACT_NAME}"${url ? ` (${url})` : ""}.`);
		return { ...(id !== undefined ? { id } : {}), ...(url ? { url } : {}), files: list.length };
	} catch (error) {
		core.warning(`Could not upload the report artifact: ${errorMessage(error)}`);
		return undefined;
	}
}
