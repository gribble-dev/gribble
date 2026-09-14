import { describe, expect, it, vi } from "vitest";
import {
	appendUnplaced,
	commentCandidates,
	extractFingerprint,
	findingCommentBody,
	PATCHED_PREFIX,
	patchedBody,
	planComments,
	syncComments,
} from "../src/comments.js";
import { parseDiffLines, toDiffIndex } from "../src/diff.js";
import type { GitHubClient } from "../src/github.js";
import type { ResolvedLocation } from "../src/locate.js";
import type { Finding } from "../src/types.js";
import { finding, loaded, report } from "./fixtures.js";

const diff = toDiffIndex([
	{ filename: "src/app.tsx", patch: "@@ -1,3 +1,5 @@\n a\n+b\n+c\n d\n e" },
	{ filename: "src/other.ts", patch: "@@ -10,2 +10,3 @@\n x\n+y\n z" },
]);

function locate(f: Finding): ResolvedLocation | undefined {
	const file = f.location?.file;
	if (!file) return undefined;
	const line = Number(f.location?.symbol?.replace(/\D/g, "") ?? 1);
	return { path: file, line, symbolFound: Boolean(f.location?.symbol) };
}

describe("markers", () => {
	it("extracts fingerprints from bodies", () => {
		expect(extractFingerprint("<!-- gribble:fp:abc123 -->\nhello")).toBe("abc123");
		expect(extractFingerprint("text <!-- gribble:fp:  deadbeef -->")).toBe("deadbeef");
		expect(extractFingerprint("<!-- gribble:summary -->")).toBeUndefined();
		expect(extractFingerprint(undefined)).toBeUndefined();
	});

	it("puts the marker first in a finding body", () => {
		const body = findingCommentBody(finding({ fingerprint: "f1", suggestion: "Do the thing." }));
		expect(body.startsWith("<!-- gribble:fp:f1 -->")).toBe(true);
		expect(body).toContain("**Fix:** Do the thing.");
		expect(body).toContain("gribble ignore f1");
	});

	it("prepends patched and keeps the marker", () => {
		const body = findingCommentBody(finding({ fingerprint: "f2" }));
		const patched = patchedBody(body);
		expect(patched.startsWith("<!-- gribble:fp:f2 -->\npatched ✅")).toBe(true);
		expect(extractFingerprint(patched)).toBe("f2");
		expect(patchedBody(patched)).toBe(patched);
		expect(patchedBody("no marker here").startsWith(PATCHED_PREFIX)).toBe(true);
	});
});

describe("parseDiffLines", () => {
	it("returns right-hand lines including context", () => {
		expect([...parseDiffLines("@@ -1,3 +1,5 @@\n a\n+b\n+c\n d\n e")]).toEqual([1, 2, 3, 4, 5]);
		expect([...parseDiffLines("@@ -10,2 +10,3 @@\n x\n+y\n z")]).toEqual([10, 11, 12]);
		expect([...parseDiffLines("@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file")]).toEqual([1]);
		expect(parseDiffLines(undefined).size).toBe(0);
	});
});

describe("commentCandidates", () => {
	it("drops info and non-new, sorts by severity, confidence, deterministic first", () => {
		const list = [
			finding({ fingerprint: "info", severity: "info" }),
			finding({ fingerprint: "ai-warn-low", severity: "warn", source: "ai", confidence: 0.7 }),
			finding({ fingerprint: "det-warn", severity: "warn" }),
			finding({ fingerprint: "ai-warn-high", severity: "warn", source: "ai", confidence: 0.95 }),
			finding({ fingerprint: "existing", severity: "critical", status: "existing" }),
			finding({ fingerprint: "err", severity: "error" }),
			finding({ fingerprint: "crit", severity: "critical" }),
			finding({ fingerprint: "ai-warn-1", severity: "warn", source: "ai", confidence: 1 }),
		];
		expect(commentCandidates(list).map((f) => f.fingerprint)).toEqual([
			"crit",
			"err",
			"det-warn",
			"ai-warn-1",
			"ai-warn-high",
			"ai-warn-low",
		]);
	});
});

describe("planComments", () => {
	it("creates inline comments for findings in the diff, lists the rest", () => {
		const findings = [
			finding({ fingerprint: "a", severity: "error", location: { file: "src/app.tsx", symbol: "line2" } }),
			finding({ fingerprint: "b", severity: "error", location: { file: "src/nope.ts", symbol: "line1" } }),
			finding({ fingerprint: "c", severity: "warn", location: { selector: "#x" } }),
			finding({ fingerprint: "d", severity: "warn", location: { file: "src/other.ts", symbol: "line99" } }),
		];
		const plan = planComments({ findings, existing: [], diff, maxComments: 5, locate });
		expect(plan.create.map((c) => [c.finding.fingerprint, c.path, c.line])).toEqual([
			["a", "src/app.tsx", 2],
			["d", "src/other.ts", undefined],
		]);
		expect(plan.unplaced.map((f) => f.fingerprint)).toEqual(["b", "c"]);
		expect(plan.update).toEqual([]);
		expect(plan.patch).toEqual([]);
		expect(plan.candidateCount).toBe(4);
	});

	it("respects max-comments in severity order and lists the overflow", () => {
		const findings = [
			finding({ fingerprint: "w", severity: "warn", location: { file: "src/app.tsx", symbol: "line1" } }),
			finding({ fingerprint: "c", severity: "critical", location: { file: "src/app.tsx", symbol: "line2" } }),
			finding({ fingerprint: "e", severity: "error", location: { file: "src/app.tsx", symbol: "line3" } }),
		];
		const plan = planComments({ findings, existing: [], diff, maxComments: 2, locate });
		expect(plan.selected.map((f) => f.fingerprint)).toEqual(["c", "e"]);
		expect(plan.create.map((c) => c.finding.fingerprint)).toEqual(["c", "e"]);
		expect(plan.unplaced.map((f) => f.fingerprint)).toEqual(["w"]);
		expect(planComments({ findings, existing: [], diff, maxComments: 0, locate }).create).toEqual([]);
	});

	it("updates existing comments in place, patches vanished ones, never comments baseline findings", () => {
		const findings = [
			finding({ fingerprint: "keep", severity: "error", location: { file: "src/app.tsx", symbol: "line2" } }),
			finding({
				fingerprint: "old",
				severity: "error",
				status: "existing",
				location: { file: "src/app.tsx", symbol: "line2" },
			}),
			finding({ fingerprint: "fixed", severity: "error", status: "fixed" }),
			finding({ fingerprint: "fresh", severity: "warn", location: { file: "src/app.tsx", symbol: "line3" } }),
		];
		const existing = [
			{ id: 1, nodeId: "n1", body: "<!-- gribble:fp:keep -->\nold body" },
			{ id: 2, nodeId: "n2", body: "<!-- gribble:fp:gone -->\n**error** gone finding" },
			{ id: 3, nodeId: "n3", body: "<!-- gribble:fp:fixed -->\nfixed one" },
			{ id: 4, body: "unrelated human comment" },
		];
		const plan = planComments({ findings, existing, diff, maxComments: 5, locate });
		expect(plan.update.map((u) => [u.id, u.finding.fingerprint])).toEqual([[1, "keep"]]);
		expect(plan.patch.map((p) => [p.id, p.fingerprint, p.nodeId])).toEqual([
			[2, "gone", "n2"],
			[3, "fixed", "n3"],
		]);
		expect(plan.patch[0]?.body).toContain(PATCHED_PREFIX);
		expect(plan.create.map((c) => c.finding.fingerprint)).toEqual(["fresh"]);
		expect(plan.unplaced).toEqual([]);
	});

	it("keeps updating a previously commented finding even when it falls outside the cap", () => {
		const findings = [
			finding({
				fingerprint: "top",
				severity: "critical",
				location: { file: "src/app.tsx", symbol: "line1" },
			}),
			finding({
				fingerprint: "commented",
				severity: "warn",
				location: { file: "src/app.tsx", symbol: "line2" },
			}),
		];
		const existing = [{ id: 9, body: "<!-- gribble:fp:commented -->" }];
		const plan = planComments({ findings, existing, diff, maxComments: 1, locate });
		expect(plan.update.map((u) => u.id)).toEqual([9]);
		expect(plan.create.map((c) => c.finding.fingerprint)).toEqual(["top"]);
		expect(plan.unplaced).toEqual([]);
	});

	it("is deterministic for equal severities", () => {
		const findings = [
			finding({ fingerprint: "zz", severity: "warn" }),
			finding({ fingerprint: "aa", severity: "warn" }),
			finding({ fingerprint: "mm", severity: "warn" }),
		];
		const plan = planComments({ findings, existing: [], diff, maxComments: 2, locate });
		expect(plan.selected.map((f) => f.fingerprint)).toEqual(["aa", "mm"]);
	});
});

describe("appendUnplaced", () => {
	it("lists unplaced findings sorted by severity", () => {
		const body = appendUnplaced("<!-- gribble:summary -->\nsummary", [
			{
				finding: finding({
					fingerprint: "w",
					severity: "warn",
					title: "Warn one",
					location: { selector: "#a" },
				}),
				targetName: "",
			},
			{
				finding: finding({
					fingerprint: "e",
					severity: "error",
					title: "Error one",
					location: { file: "src/x.ts", symbol: "X" },
				}),
				targetName: "apps/web",
			},
		]);
		expect(body).toContain("### Findings without an inline comment");
		const w = body.indexOf("Warn one");
		const e = body.indexOf("Error one");
		expect(e).toBeGreaterThan(-1);
		expect(e).toBeLessThan(w);
		expect(body).toContain("apps/web · `src/x.ts#X`");
		expect(appendUnplaced("x", [])).toBe("x");
	});
});

describe("syncComments (mocked octokit)", () => {
	function mockClient(opts: {
		reviewComments?: Array<{ id: number; node_id: string; body: string; path: string; line?: number }>;
		issueComments?: Array<{ id: number; body: string }>;
		files?: Array<{ filename: string; patch?: string }>;
		threads?: Array<{ id: string; isResolved: boolean; firstCommentId: number }>;
		forbidden?: boolean;
	}) {
		const forbidden = () =>
			Object.assign(new Error("Resource not accessible by integration"), { status: 403 });
		const calls: Record<string, unknown[]> = {};
		const record = (name: string, fn: (...args: unknown[]) => unknown) =>
			vi.fn((...args: unknown[]) => {
				const list = calls[name] ?? [];
				list.push(args[0]);
				calls[name] = list;
				if (opts.forbidden) throw forbidden();
				return fn(...args);
			});
		const client = {
			rest: {
				checks: {
					create: record("checks.create", async () => ({ data: { id: 1 } })),
					update: record("checks.update", async () => ({})),
				},
				issues: {
					listComments: record("issues.listComments", async () => ({ data: opts.issueComments ?? [] })),
					createComment: record("issues.createComment", async () => ({ data: { id: 100 } })),
					updateComment: record("issues.updateComment", async () => ({})),
				},
				pulls: {
					listFiles: record("pulls.listFiles", async () => ({ data: opts.files ?? [] })),
					listReviewComments: record("pulls.listReviewComments", async () => ({
						data: opts.reviewComments ?? [],
					})),
					createReviewComment: record("pulls.createReviewComment", async () => ({
						data: { id: 200, body: "", path: "" },
					})),
					updateReviewComment: record("pulls.updateReviewComment", async () => ({})),
					create: record("pulls.create", async () => ({ data: { number: 1 } })),
				},
			},
			graphql: record("graphql", async (query: unknown) => {
				if (String(query).includes("resolveReviewThread"))
					return { resolveReviewThread: { thread: { isResolved: true } } };
				return {
					repository: {
						pullRequest: {
							reviewThreads: {
								pageInfo: { hasNextPage: false, endCursor: null },
								nodes: (opts.threads ?? []).map((t) => ({
									id: t.id,
									isResolved: t.isResolved,
									comments: { nodes: [{ databaseId: t.firstCommentId }] },
								})),
							},
						},
					},
				};
			}),
		};
		return { client: client as unknown as GitHubClient, calls };
	}

	const pr = { owner: "o", repo: "r", number: 7, headSha: "abc" };

	it("creates, updates, patches and resolves, then updates the summary", async () => {
		const src = "export function Hero() {}\nexport function Footer() {}\n";
		const { client, calls } = mockClient({
			files: [
				{
					filename: "src/app.tsx",
					patch: "@@ -1,2 +1,2 @@\n export function Hero() {}\n+export function Footer() {}",
				},
			],
			reviewComments: [
				{ id: 1, node_id: "n1", body: "<!-- gribble:fp:keep -->\nold", path: "src/app.tsx", line: 1 },
				{ id: 2, node_id: "n2", body: "<!-- gribble:fp:gone -->\nold", path: "src/app.tsx", line: 2 },
			],
			issueComments: [{ id: 50, body: "<!-- gribble:summary -->\nold summary" }],
			threads: [{ id: "T2", isResolved: false, firstCommentId: 2 }],
		});
		const findings = [
			finding({ fingerprint: "keep", location: { file: "src/app.tsx", symbol: "Hero" } }),
			finding({ fingerprint: "new", location: { file: "src/app.tsx", symbol: "Footer" } }),
			finding({ fingerprint: "nofile", severity: "warn" }),
		];
		const result = await syncComments({
			client,
			pr,
			loaded: [loaded(report({ findings }))],
			summaryBody: "<!-- gribble:summary -->\nnew summary",
			maxComments: 5,
			repoRoot: "/repo",
			readFile: (p) => (p.replace(/\\/g, "/") === "/repo/src/app.tsx" ? src : undefined),
		});
		expect(result).toMatchObject({ created: 1, updated: 1, patched: 1, resolved: 1, summary: "updated" });
		expect(result.unplaced.map((u) => u.finding.fingerprint)).toEqual(["nofile"]);
		expect(calls["pulls.createReviewComment"]?.[0]).toMatchObject({
			path: "src/app.tsx",
			line: 2,
			side: "RIGHT",
			commit_id: "abc",
		});
		const reviewUpdates = calls["pulls.updateReviewComment"] as Array<{ body: string }>;
		expect(reviewUpdates).toHaveLength(2);
		expect(reviewUpdates[1]?.body).toContain(PATCHED_PREFIX);
		expect(calls.graphql).toHaveLength(2);
		const summaryUpdates = calls["issues.updateComment"] as Array<{ body: string; comment_id: number }>;
		expect(summaryUpdates[0]?.comment_id).toBe(50);
		expect(summaryUpdates[0]?.body).toContain("Findings without an inline comment");
	});

	it("creates the summary when none exists", async () => {
		const { client, calls } = mockClient({});
		const result = await syncComments({
			client,
			pr,
			loaded: [loaded(report({ findings: [] }))],
			summaryBody: "<!-- gribble:summary -->\nclean",
			maxComments: 5,
			repoRoot: "/repo",
			readFile: () => undefined,
		});
		expect(result.summary).toBe("created");
		expect(calls["issues.createComment"]).toHaveLength(1);
	});

	it("warns instead of failing without pull-requests: write", async () => {
		const { client } = mockClient({ forbidden: true });
		const result = await syncComments({
			client,
			pr,
			loaded: [loaded(report({ findings: [finding()] }))],
			summaryBody: "<!-- gribble:summary -->",
			maxComments: 5,
			repoRoot: "/repo",
			readFile: () => undefined,
		});
		expect(result.summary).toBe("skipped");
		expect(result.warnings.length).toBeGreaterThan(0);
		expect(result.warnings[0]).toMatch(/pull-requests: write/);
	});
});
