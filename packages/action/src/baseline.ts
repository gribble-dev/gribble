/**
 * Baseline write-back on pushes to the default branch (brief §20).
 * `baseline.update` in gribble.yaml: `commit` (default) commits to the branch
 * with `[skip ci]`, `pr` opens a chore PR from `gribble/baseline-<sha7>`, `manual` does nothing.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { parse as parseYaml } from "yaml";
import { errorMessage, type GitHubClient, isPermissionError, type RepoRef } from "./github.js";
import type { LoadedReport } from "./types.js";

export type BaselineUpdateMode = "commit" | "pr" | "manual";

export const BOT_NAME = "github-actions[bot]";
export const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";
export const COMMIT_MESSAGE = "chore(gribble): update baseline [skip ci]";

/** Read `baseline.update` (with the environment overlay applied) from gribble.yaml. */
export function baselineUpdateModeFromYaml(yamlText: string, environment?: string): BaselineUpdateMode {
	let doc: unknown;
	try {
		doc = parseYaml(yamlText);
	} catch {
		return "commit";
	}
	const read = (obj: unknown): string | undefined => {
		if (!obj || typeof obj !== "object") return undefined;
		const baseline = (obj as Record<string, unknown>).baseline;
		if (!baseline || typeof baseline !== "object") return undefined;
		const update = (baseline as Record<string, unknown>).update;
		return typeof update === "string" ? update : undefined;
	};
	let mode = read(doc);
	if (environment && doc && typeof doc === "object") {
		const envs = (doc as Record<string, unknown>).environments;
		if (envs && typeof envs === "object") mode = read((envs as Record<string, unknown>)[environment]) ?? mode;
	}
	return mode === "pr" || mode === "manual" ? mode : "commit";
}

export async function readBaselineUpdateMode(
	gribbleDir: string,
	environment?: string,
): Promise<BaselineUpdateMode> {
	try {
		const text = await fs.readFile(path.join(gribbleDir, "gribble.yaml"), "utf8");
		return baselineUpdateModeFromYaml(text, environment);
	} catch {
		return "commit";
	}
}

export function shortSha(sha: string): string {
	return sha.slice(0, 7);
}

export function isPushToDefaultBranch(ctx: {
	eventName: string;
	ref: string;
	defaultBranch: string;
}): boolean {
	return ctx.eventName === "push" && ctx.ref === `refs/heads/${ctx.defaultBranch}`;
}

async function git(
	args: string[],
	cwd: string,
	opts: { silent?: boolean } = {},
): Promise<{ code: number; stdout: string }> {
	const res = await exec.getExecOutput("git", args, {
		cwd,
		ignoreReturnCode: true,
		silent: opts.silent ?? false,
	});
	return { code: res.exitCode, stdout: res.stdout };
}

export interface BaselineWriteBackOptions {
	client: GitHubClient;
	repo: RepoRef;
	repoRoot: string;
	loaded: LoadedReport[];
	sha: string;
	defaultBranch: string;
	environment?: string;
	serverUrl: string;
	runId: number;
}

export interface BaselineWriteBackResult {
	mode: BaselineUpdateMode;
	changed: boolean;
	committed: boolean;
	prUrl?: string;
	branch?: string;
}

/** Commit or PR the updated `.gribble/baseline/` directories. Never throws on permission problems. */
export async function writeBackBaseline(opts: BaselineWriteBackOptions): Promise<BaselineWriteBackResult> {
	const { repoRoot } = opts;
	// One mode for the run: the first target's setting wins; `manual` on any target is respected for that target only.
	const targets: Array<{ dir: string; mode: BaselineUpdateMode }> = [];
	for (const l of opts.loaded) {
		const mode = await readBaselineUpdateMode(l.gribbleDir, opts.environment);
		targets.push({ dir: path.join(l.gribbleDir, "baseline"), mode });
	}
	const active = targets.filter((t) => t.mode !== "manual");
	const mode: BaselineUpdateMode = active.some((t) => t.mode === "pr")
		? "pr"
		: active.length > 0
			? "commit"
			: "manual";
	if (mode === "manual") {
		core.info("baseline.update is manual; leaving .gribble/baseline untouched.");
		return { mode, changed: false, committed: false };
	}

	const pathspecs = active.map((t) => path.relative(repoRoot, t.dir) || ".");
	const status = await git(["status", "--porcelain", "--", ...pathspecs], repoRoot, { silent: true });
	if (status.stdout.trim() === "") {
		core.info("Baseline unchanged; nothing to commit.");
		return { mode, changed: false, committed: false };
	}

	await git(["config", "user.name", BOT_NAME], repoRoot, { silent: true });
	await git(["config", "user.email", BOT_EMAIL], repoRoot, { silent: true });

	const branch = mode === "pr" ? `gribble/baseline-${shortSha(opts.sha)}` : opts.defaultBranch;
	if (mode === "pr") {
		const checkout = await git(["checkout", "-B", branch], repoRoot);
		if (checkout.code !== 0) {
			core.warning(`Could not create branch ${branch}; baseline not written back.`);
			return { mode, changed: true, committed: false };
		}
	}
	const add = await git(["add", "--", ...pathspecs], repoRoot);
	if (add.code !== 0) {
		core.warning("git add failed; baseline not written back.");
		return { mode, changed: true, committed: false };
	}
	const commit = await git(["commit", "-m", COMMIT_MESSAGE], repoRoot);
	if (commit.code !== 0) {
		core.warning("git commit failed; baseline not written back.");
		return { mode, changed: true, committed: false };
	}

	const pushArgs =
		mode === "pr" ? ["push", "--force", "-u", "origin", branch] : ["push", "origin", `HEAD:${branch}`];
	const push = await git(pushArgs, repoRoot);
	if (push.code !== 0) {
		core.warning(
			`git push failed (exit ${push.code}). The job needs \`contents: write\` (and \`pull-requests: write\` for baseline.update: pr), and a checkout with a pushable token.`,
		);
		return { mode, changed: true, committed: true, branch };
	}
	if (mode === "commit") {
		core.info(`Baseline committed to ${branch}: ${COMMIT_MESSAGE}`);
		return { mode, changed: true, committed: true, branch };
	}

	try {
		const pr = await opts.client.rest.pulls.create({
			...opts.repo,
			title: "chore(gribble): update baseline",
			head: branch,
			base: opts.defaultBranch,
			body: [
				"The gribbles surveyed the hull after the last merge and updated `.gribble/baseline/`.",
				"",
				`Source commit: ${opts.sha}`,
				`Workflow run: ${opts.serverUrl}/${opts.repo.owner}/${opts.repo.repo}/actions/runs/${opts.runId}`,
				"",
				"Merge to make these findings and metrics the new known state for pull requests.",
			].join("\n"),
		});
		core.info(`Opened baseline PR: ${pr.data.html_url ?? `#${pr.data.number}`}`);
		return {
			mode,
			changed: true,
			committed: true,
			branch,
			...(pr.data.html_url ? { prUrl: pr.data.html_url } : {}),
		};
	} catch (error) {
		if (isPermissionError(error)) {
			core.warning(
				`Pushed ${branch} but could not open a pull request (${errorMessage(error)}). Grant \`pull-requests: write\`.`,
			);
			return { mode, changed: true, committed: true, branch };
		}
		if (/A pull request already exists/i.test(errorMessage(error))) {
			core.info(`A baseline pull request for ${branch} already exists.`);
			return { mode, changed: true, committed: true, branch };
		}
		throw error;
	}
}
