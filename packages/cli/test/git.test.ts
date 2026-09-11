import { describe, expect, it } from "vitest";
import { createGitApi, type GitExec } from "../src/git.js";

function fakeGit(responses: Record<string, string | undefined>): { exec: GitExec; calls: string[] } {
	const calls: string[] = [];
	const exec: GitExec = async (args) => {
		const key = args.join(" ");
		calls.push(key);
		return responses[key];
	};
	return { exec, calls };
}

describe("git helpers", () => {
	it("returns nothing outside a work tree", async () => {
		const { exec } = fakeGit({});
		expect(await createGitApi(exec).info("/x", {})).toEqual({});
	});

	it("collects commit, branch, remote and the merge base with origin/main", async () => {
		const { exec } = fakeGit({
			"rev-parse --is-inside-work-tree": "true",
			"rev-parse HEAD": "abc123",
			"rev-parse --abbrev-ref HEAD": "feature/x",
			"remote get-url origin": "git@github.com:acme/site.git",
			"merge-base origin/main HEAD": "base456",
		});
		expect(await createGitApi(exec).info("/x", {})).toEqual({
			commit: "abc123",
			branch: "feature/x",
			remote: "git@github.com:acme/site.git",
			baseCommit: "base456",
			baseRef: "origin/main",
		});
	});

	it("prefers GITHUB_BASE_REF and GITHUB_HEAD_REF on a pull request", async () => {
		const { exec, calls } = fakeGit({
			"rev-parse --is-inside-work-tree": "true",
			"rev-parse HEAD": "abc",
			"rev-parse --abbrev-ref HEAD": "HEAD",
			"merge-base origin/develop HEAD": "base",
		});
		const info = await createGitApi(exec).info("/x", { GITHUB_BASE_REF: "develop", GITHUB_HEAD_REF: "feat" });
		expect(info.branch).toBe("feat");
		expect(info.baseRef).toBe("origin/develop");
		expect(calls).toContain("merge-base origin/develop HEAD");
		expect(calls).not.toContain("merge-base origin/main HEAD");
	});

	it("merges committed and working-tree changes, falling back to a two-dot diff", async () => {
		const { exec } = fakeGit({
			"diff --name-only base...HEAD": "a.ts\nb.ts\n",
			"diff --name-only HEAD": "b.ts\nc.ts\n",
		});
		expect(await createGitApi(exec).changedFiles("/x", {}, "base")).toEqual(["a.ts", "b.ts", "c.ts"]);

		const shallow = fakeGit({ "diff --name-only base HEAD": "z.ts\n" });
		expect(await createGitApi(shallow.exec).changedFiles("/x", {}, "base")).toEqual(["z.ts"]);

		const broken = fakeGit({});
		expect(await createGitApi(broken.exec).changedFiles("/x", {}, "base")).toBeUndefined();
	});
});
