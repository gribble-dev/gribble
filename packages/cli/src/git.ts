import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Runs `git <args>` in `cwd` and returns trimmed stdout, or undefined on any failure. */
export type GitExec = (args: string[], cwd: string, env: NodeJS.ProcessEnv) => Promise<string | undefined>;

export const defaultGitExec: GitExec = async (args, cwd, env) => {
	try {
		const { stdout } = await execFileAsync("git", args, {
			cwd,
			env: { ...env, GIT_TERMINAL_PROMPT: "0" },
			maxBuffer: 16 * 1024 * 1024,
		});
		return stdout.trim();
	} catch {
		return undefined;
	}
};

export interface GitInfo {
	commit?: string;
	branch?: string;
	remote?: string;
	/** Merge base with the base branch, when one could be determined. */
	baseCommit?: string;
	/** Ref the base commit was derived from, e.g. `origin/main`. */
	baseRef?: string;
}

export interface GitApi {
	info(cwd: string, env: NodeJS.ProcessEnv): Promise<GitInfo>;
	changedFiles(cwd: string, env: NodeJS.ProcessEnv, baseCommit: string): Promise<string[] | undefined>;
}

/**
 * Base branch candidates: `GITHUB_BASE_REF` (pull requests), then `origin/main`, `origin/master`,
 * then the local `main`/`master`. The first ref that resolves wins.
 */
function baseRefCandidates(env: NodeJS.ProcessEnv): string[] {
	const out: string[] = [];
	const ghBase = env.GITHUB_BASE_REF?.trim();
	if (ghBase) out.push(`origin/${ghBase}`, ghBase);
	out.push("origin/main", "origin/master", "main", "master");
	return out;
}

export function createGitApi(exec: GitExec = defaultGitExec): GitApi {
	return {
		async info(cwd, env) {
			const inside = await exec(["rev-parse", "--is-inside-work-tree"], cwd, env);
			if (inside !== "true") return {};
			const [commit, branchRaw, remote] = await Promise.all([
				exec(["rev-parse", "HEAD"], cwd, env),
				exec(["rev-parse", "--abbrev-ref", "HEAD"], cwd, env),
				exec(["remote", "get-url", "origin"], cwd, env),
			]);
			const info: GitInfo = {};
			if (commit) info.commit = commit;
			const branch = env.GITHUB_HEAD_REF?.trim() || branchRaw;
			if (branch && branch !== "HEAD") info.branch = branch;
			if (remote) info.remote = remote;
			for (const ref of baseRefCandidates(env)) {
				const base = await exec(["merge-base", ref, "HEAD"], cwd, env);
				if (base) {
					info.baseCommit = base;
					info.baseRef = ref;
					break;
				}
			}
			return info;
		},
		async changedFiles(cwd, env, baseCommit) {
			const committed = await exec(["diff", "--name-only", `${baseCommit}...HEAD`], cwd, env);
			if (committed === undefined) {
				// A shallow clone may lack the three-dot range; fall back to a two-dot diff.
				const twoDot = await exec(["diff", "--name-only", baseCommit, "HEAD"], cwd, env);
				if (twoDot === undefined) return undefined;
				return merge(twoDot, await exec(["diff", "--name-only", "HEAD"], cwd, env));
			}
			return merge(committed, await exec(["diff", "--name-only", "HEAD"], cwd, env));
		},
	};
}

function merge(...outputs: Array<string | undefined>): string[] {
	const files = new Set<string>();
	for (const out of outputs) {
		if (!out) continue;
		for (const line of out.split("\n")) {
			const f = line.trim();
			if (f) files.add(f);
		}
	}
	return [...files].sort();
}
