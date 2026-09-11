import { describe, expect, it, vi } from "vitest";
import {
	ANNOTATIONS_PER_CALL,
	buildAnnotations,
	chunk,
	createCheckRun,
	severityToAnnotationLevel,
} from "../src/checks.js";
import type { GitHubClient } from "../src/github.js";
import { locateFinding, resolveLine } from "../src/locate.js";
import { finding } from "./fixtures.js";

describe("resolveLine", () => {
	const content = [
		"import x from 'y';",
		"",
		"export function ButtonGroup() {}",
		"export function Button() {",
		"  return null;",
		"}",
	].join("\n");

	it("prefers whole-word matches", () => {
		expect(resolveLine(content, "Button")).toEqual({ line: 4, found: true });
		expect(resolveLine(content, "ButtonGroup")).toEqual({ line: 3, found: true });
	});

	it("falls back to substring, then line 1", () => {
		expect(resolveLine(content, "tonGr")).toEqual({ line: 3, found: true });
		expect(resolveLine(content, "Missing")).toEqual({ line: 1, found: false });
		expect(resolveLine(content, undefined)).toEqual({ line: 1, found: false });
		expect(resolveLine(undefined, "Button")).toEqual({ line: 1, found: false });
	});

	it("handles regex characters in symbols", () => {
		expect(resolveLine("a\n$store.value\nb", "$store.value")).toEqual({ line: 2, found: true });
	});
});

describe("locateFinding", () => {
	const files: Record<string, string> = {
		"/repo/src/a.ts": "one\nexport const Hero = 1\n",
		"/repo/apps/web/src/b.ts": "export const Nav = 1\n",
	};
	const readFile = (p: string) => files[p];

	it("resolves repo-root relative paths and symbols", () => {
		const f = finding({ location: { file: "src/a.ts", symbol: "Hero" } });
		expect(locateFinding(f, { repoRoot: "/repo", readFile })).toEqual({
			path: "src/a.ts",
			line: 2,
			symbolFound: true,
		});
	});

	it("falls back to the target directory", () => {
		const f = finding({ location: { file: "src/b.ts", symbol: "Nav" } });
		expect(locateFinding(f, { repoRoot: "/repo", searchRoots: ["/repo/apps/web"], readFile })).toEqual({
			path: "apps/web/src/b.ts",
			line: 1,
			symbolFound: true,
		});
	});

	it("keeps the path with line 1 when the file is unknown", () => {
		const f = finding({ location: { file: "./src/missing.ts", symbol: "X" } });
		expect(locateFinding(f, { repoRoot: "/repo", readFile })).toEqual({
			path: "src/missing.ts",
			line: 1,
			symbolFound: false,
		});
		expect(
			locateFinding(finding({ location: { selector: "#x" } }), { repoRoot: "/repo", readFile }),
		).toBeUndefined();
	});
});

describe("buildAnnotations", () => {
	it("maps severities and skips findings without a file or not new", () => {
		expect(severityToAnnotationLevel("critical")).toBe("failure");
		expect(severityToAnnotationLevel("error")).toBe("failure");
		expect(severityToAnnotationLevel("warn")).toBe("warning");
		expect(severityToAnnotationLevel("info")).toBe("notice");

		const findings = [
			finding({ location: { file: "src/a.ts", symbol: "Hero" }, severity: "warn", suggestion: "Fix it." }),
			finding({ location: { file: "src/a.ts", symbol: "Hero" }, status: "existing" }),
			finding({ location: { selector: "#x" } }),
		];
		const annotations = buildAnnotations(findings, {
			repoRoot: "/repo",
			readFile: (p) => (p === "/repo/src/a.ts" ? "a\nHero\n" : undefined),
		});
		expect(annotations).toHaveLength(1);
		expect(annotations[0]).toMatchObject({
			path: "src/a.ts",
			start_line: 2,
			end_line: 2,
			annotation_level: "warning",
		});
		expect(annotations[0]?.message).toContain("Fix: Fix it.");
	});
});

describe("createCheckRun", () => {
	it("batches annotations 50 per call", async () => {
		const create = vi.fn(async () => ({ data: { id: 42, html_url: "https://x/check" } }));
		const update = vi.fn(async () => ({}));
		const client = { rest: { checks: { create, update } } } as unknown as GitHubClient;
		const annotations = Array.from({ length: 120 }, (_, i) => ({
			path: "a.ts",
			start_line: i + 1,
			end_line: i + 1,
			annotation_level: "notice" as const,
			message: "m",
		}));
		expect(chunk(annotations, ANNOTATIONS_PER_CALL).map((c) => c.length)).toEqual([50, 50, 20]);
		const url = await createCheckRun(client, {
			repo: { owner: "o", repo: "r" },
			headSha: "sha",
			conclusion: "success",
			title: "t",
			summary: "s",
			annotations,
		});
		expect(url).toBe("https://x/check");
		expect(create).toHaveBeenCalledTimes(1);
		expect((create.mock.calls[0] as unknown[])[0]).toMatchObject({
			name: "Gribble",
			head_sha: "sha",
			conclusion: "success",
		});
		expect(update).toHaveBeenCalledTimes(2);
	});

	it("degrades to log annotations without checks: write", async () => {
		const create = vi.fn(async () => {
			throw Object.assign(new Error("Resource not accessible by integration"), { status: 403 });
		});
		const client = { rest: { checks: { create, update: vi.fn() } } } as unknown as GitHubClient;
		const url = await createCheckRun(client, {
			repo: { owner: "o", repo: "r" },
			headSha: "sha",
			conclusion: "failure",
			title: "t",
			summary: "s",
			annotations: [{ path: "a.ts", start_line: 1, end_line: 1, annotation_level: "failure", message: "m" }],
		});
		expect(url).toBeUndefined();
	});
});
