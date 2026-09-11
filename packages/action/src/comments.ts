/**
 * PR comment lifecycle (brief §15):
 * - one summary comment marked `<!-- gribble:summary -->`, updated in place;
 * - one review comment per new finding that maps into the diff, marked
 *   `<!-- gribble:fp:<fingerprint> -->`; re-runs update in place;
 * - fingerprints that disappeared get "patched ✅" prepended and their thread resolved;
 * - findings that do not map into the diff are listed in the summary;
 * - the `max-comments` cap applies to new findings only, ordered by severity,
 *   confidence, deterministic-first. Existing baseline findings are counted, never commented.
 */
import * as core from "@actions/core";
import type { DiffFile } from "./diff.js";
import { sortFindingsForDisplay } from "./fallback-formatters.js";
import {
	errorMessage,
	type GitHubClient,
	isPermissionError,
	paginate,
	type RepoRef,
	type ReviewCommentRecord,
} from "./github.js";
import { type LocateOptions, locateFinding, type ResolvedLocation } from "./locate.js";
import { type Finding, FP_MARKER_PREFIX, fpMarker, type LoadedReport, SUMMARY_MARKER } from "./types.js";

export const PATCHED_PREFIX = "patched ✅";

export interface ExistingComment {
	id: number;
	nodeId?: string;
	body: string;
	path?: string;
	line?: number;
}

export interface PlannedCreate {
	finding: Finding;
	path: string;
	/** Undefined -> file-level comment (line not part of the diff). */
	line?: number;
	body: string;
}

export interface PlannedUpdate {
	id: number;
	finding: Finding;
	body: string;
}

export interface PlannedPatch {
	id: number;
	nodeId?: string;
	fingerprint: string;
	body: string;
}

export interface CommentPlan {
	create: PlannedCreate[];
	update: PlannedUpdate[];
	patch: PlannedPatch[];
	/** New findings that could not get an inline comment (not in the diff, no file, or over the cap). */
	unplaced: Finding[];
	/** New findings selected by the cap (subset of candidates). */
	selected: Finding[];
	/** Total number of comment-worthy new findings before the cap. */
	candidateCount: number;
}

export interface PlanInput {
	findings: Finding[];
	existing: ExistingComment[];
	diff: Map<string, DiffFile>;
	maxComments: number;
	locate: (finding: Finding) => ResolvedLocation | undefined;
	/** Optional label prefix (monorepo target name). */
	targetName?: string;
}

export function extractFingerprint(body: string | null | undefined): string | undefined {
	if (!body) return undefined;
	const start = body.indexOf(FP_MARKER_PREFIX);
	if (start === -1) return undefined;
	const rest = body.slice(start + FP_MARKER_PREFIX.length);
	const end = rest.indexOf("-->");
	if (end === -1) return undefined;
	const fp = rest.slice(0, end).trim();
	return fp || undefined;
}

export function isSummaryComment(body: string | null | undefined): boolean {
	return typeof body === "string" && body.includes(SUMMARY_MARKER);
}

const SEVERITY_ICON: Record<Finding["severity"], string> = {
	critical: "🛑",
	error: "❌",
	warn: "⚠️",
	info: "ℹ️",
};

export function findingCommentBody(f: Finding, opts: { targetName?: string } = {}): string {
	const lines: string[] = [fpMarker(f.fingerprint)];
	const where = opts.targetName ? `${opts.targetName} · ` : "";
	lines.push(`**${SEVERITY_ICON[f.severity]} ${f.severity} · [\`${f.rule}\`](${f.docsUrl})** — ${f.title}`);
	lines.push("");
	if (f.message) {
		lines.push(f.message);
		lines.push("");
	}
	const meta: string[] = [`${where}route \`${f.route}\``];
	if (f.viewport) meta.push(`viewport ${f.viewport}`);
	if (f.location?.symbol) meta.push(`symbol \`${f.location.symbol}\``);
	if (f.location?.selector) meta.push(`selector \`${f.location.selector}\``);
	if (f.subject) meta.push(`subject \`${f.subject}\``);
	if (f.source === "ai" && f.confidence !== undefined)
		meta.push(`confidence ${Math.round(f.confidence * 100)}%`);
	lines.push(meta.join(" · "));
	if (f.suggestion) {
		lines.push("");
		lines.push(`**Fix:** ${f.suggestion}`);
	}
	if (f.evidence?.snippet) {
		lines.push("");
		lines.push("```");
		lines.push(f.evidence.snippet.trimEnd());
		lines.push("```");
	}
	if (f.evidence?.url) {
		lines.push("");
		lines.push(`Evidence: ${f.evidence.url}`);
	}
	lines.push("");
	lines.push(
		`<sub>fingerprint \`${f.fingerprint}\` · suppress with \`gribble ignore ${f.fingerprint}\`</sub>`,
	);
	return lines.join("\n");
}

export function patchedBody(existingBody: string): string {
	if (existingBody.startsWith(PATCHED_PREFIX)) return existingBody;
	// Keep the marker first so re-runs still recognise the comment.
	const marker = existingBody.match(/<!-- gribble:fp:[^>]*-->/)?.[0];
	if (marker && existingBody.trimStart().startsWith(marker)) {
		const rest = existingBody.slice(existingBody.indexOf(marker) + marker.length).replace(/^\r?\n/, "");
		if (rest.startsWith(PATCHED_PREFIX)) return existingBody;
		return `${marker}\n${PATCHED_PREFIX}\n\n~~${firstLine(rest)}~~\n\n<details><summary>Original finding</summary>\n\n${rest}\n\n</details>`;
	}
	return `${PATCHED_PREFIX}\n\n${existingBody}`;
}

function firstLine(text: string): string {
	return (text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "").replace(/~~/g, "");
}

/** Comment-worthy: new and not info (info is report-only). */
export function commentCandidates(findings: Finding[]): Finding[] {
	return sortFindingsForDisplay(findings.filter((f) => f.status === "new" && f.severity !== "info"));
}

/** Pure planning step; no network. */
export function planComments(input: PlanInput): CommentPlan {
	const byFingerprint = new Map<string, ExistingComment>();
	for (const c of input.existing) {
		const fp = extractFingerprint(c.body);
		if (fp && !byFingerprint.has(fp)) byFingerprint.set(fp, c);
	}
	const present = new Map<string, Finding>();
	for (const f of input.findings) if (f.status !== "fixed") present.set(f.fingerprint, f);

	const candidates = commentCandidates(input.findings);
	const selected = candidates.slice(0, Math.max(0, input.maxComments));
	const selectedSet = new Set(selected.map((f) => f.fingerprint));

	const plan: CommentPlan = {
		create: [],
		update: [],
		patch: [],
		unplaced: [],
		selected,
		candidateCount: candidates.length,
	};
	const bodyOpts = input.targetName ? { targetName: input.targetName } : {};

	// Existing comments: update when the finding is still present, patch when gone.
	for (const [fp, comment] of byFingerprint) {
		const finding = present.get(fp);
		if (finding) {
			plan.update.push({ id: comment.id, finding, body: findingCommentBody(finding, bodyOpts) });
		} else {
			plan.patch.push({
				id: comment.id,
				...(comment.nodeId ? { nodeId: comment.nodeId } : {}),
				fingerprint: fp,
				body: patchedBody(comment.body),
			});
		}
	}

	for (const f of candidates) {
		if (byFingerprint.has(f.fingerprint)) continue; // handled above, keeps its thread
		if (!selectedSet.has(f.fingerprint)) {
			plan.unplaced.push(f);
			continue;
		}
		const loc = f.location?.file ? input.locate(f) : undefined;
		const diffFile = loc ? input.diff.get(loc.path) : undefined;
		if (!loc || !diffFile) {
			plan.unplaced.push(f);
			continue;
		}
		const inDiff = loc.symbolFound && diffFile.lines.has(loc.line);
		plan.create.push({
			finding: f,
			path: loc.path,
			...(inDiff ? { line: loc.line } : {}),
			body: findingCommentBody(f, bodyOpts),
		});
	}
	return plan;
}

// ---------------------------------------------------------------------------
// Network side
// ---------------------------------------------------------------------------

export interface PullRequestRef extends RepoRef {
	number: number;
	headSha: string;
}

export interface SyncOptions {
	client: GitHubClient;
	pr: PullRequestRef;
	loaded: LoadedReport[];
	summaryBody: string;
	maxComments: number;
	repoRoot: string;
	readFile?: LocateOptions["readFile"];
}

export interface SyncResult {
	created: number;
	updated: number;
	patched: number;
	resolved: number;
	summary: "created" | "updated" | "skipped";
	/** New findings without an inline comment, for the summary list. */
	unplaced: Array<{ finding: Finding; targetName: string }>;
	warnings: string[];
}

export async function fetchExistingComments(
	client: GitHubClient,
	pr: PullRequestRef,
): Promise<ReviewCommentRecord[]> {
	return paginate((page, per_page) =>
		client.rest.pulls.listReviewComments({
			owner: pr.owner,
			repo: pr.repo,
			pull_number: pr.number,
			per_page,
			page,
		}),
	);
}

export async function fetchDiff(client: GitHubClient, pr: PullRequestRef): Promise<Map<string, DiffFile>> {
	const { toDiffIndex } = await import("./diff.js");
	const files = await paginate((page, per_page) =>
		client.rest.pulls.listFiles({ owner: pr.owner, repo: pr.repo, pull_number: pr.number, per_page, page }),
	);
	return toDiffIndex(files);
}

/** Plan across all targets: the fingerprint set is global, the cap is global. */
export function planForReports(
	loaded: LoadedReport[],
	existing: ExistingComment[],
	diff: Map<string, DiffFile>,
	maxComments: number,
	repoRoot: string,
	readFile?: LocateOptions["readFile"],
): { plan: CommentPlan; targetOf: Map<string, string> } {
	const targetOf = new Map<string, string>();
	const findings: Finding[] = [];
	const locateOptsByFp = new Map<string, LocateOptions>();
	for (const l of loaded) {
		for (const f of l.report.findings) {
			findings.push(f);
			targetOf.set(f.fingerprint, l.report.target.name);
			locateOptsByFp.set(f.fingerprint, {
				repoRoot,
				searchRoots: [l.targetDir],
				...(readFile ? { readFile } : {}),
			});
		}
	}
	const multi = loaded.length > 1;
	const plan = planComments({
		findings,
		existing,
		diff,
		maxComments,
		locate: (f) => locateFinding(f, locateOptsByFp.get(f.fingerprint) ?? { repoRoot }),
		...(multi ? {} : {}),
	});
	if (multi) {
		// Re-render bodies with the target label so a monorepo summary reads well.
		for (const c of plan.create)
			c.body = findingCommentBody(c.finding, { targetName: targetOf.get(c.finding.fingerprint) ?? "" });
		for (const u of plan.update)
			u.body = findingCommentBody(u.finding, { targetName: targetOf.get(u.finding.fingerprint) ?? "" });
	}
	return { plan, targetOf };
}

const THREADS_QUERY = `
query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { id isResolved comments(first: 1) { nodes { databaseId } } }
      }
    }
  }
}`;

const RESOLVE_MUTATION = `
mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } }
}`;

interface ThreadsResponse {
	repository: {
		pullRequest: {
			reviewThreads: {
				pageInfo: { hasNextPage: boolean; endCursor: string | null };
				nodes: Array<{ id: string; isResolved: boolean; comments: { nodes: Array<{ databaseId: number }> } }>;
			};
		};
	};
}

/** Map first-comment database id -> thread id for unresolved threads. */
export async function fetchThreadIds(client: GitHubClient, pr: PullRequestRef): Promise<Map<number, string>> {
	const map = new Map<number, string>();
	let after: string | null = null;
	for (let i = 0; i < 50; i += 1) {
		const res: ThreadsResponse = await client.graphql<ThreadsResponse>(THREADS_QUERY, {
			owner: pr.owner,
			repo: pr.repo,
			number: pr.number,
			after,
		});
		const threads = res.repository.pullRequest.reviewThreads;
		for (const t of threads.nodes) {
			if (t.isResolved) continue;
			const first = t.comments.nodes[0];
			if (first) map.set(first.databaseId, t.id);
		}
		if (!threads.pageInfo.hasNextPage) break;
		after = threads.pageInfo.endCursor;
	}
	return map;
}

/** Execute the plan. Permission problems degrade to warnings instead of failing the step. */
export async function syncComments(opts: SyncOptions): Promise<SyncResult> {
	const { client, pr } = opts;
	const repo = { owner: pr.owner, repo: pr.repo };
	const result: SyncResult = {
		created: 0,
		updated: 0,
		patched: 0,
		resolved: 0,
		summary: "skipped",
		unplaced: [],
		warnings: [],
	};
	const warn = (message: string) => {
		result.warnings.push(message);
		core.warning(message);
	};

	let existing: ReviewCommentRecord[];
	let diff: Map<string, DiffFile>;
	try {
		[existing, diff] = await Promise.all([fetchExistingComments(client, pr), fetchDiff(client, pr)]);
	} catch (error) {
		if (isPermissionError(error)) {
			warn(
				`Cannot read pull request comments (${errorMessage(error)}). Grant \`pull-requests: write\` to enable PR comments.`,
			);
			return result;
		}
		throw error;
	}

	const { plan, targetOf } = planForReports(
		opts.loaded,
		existing.map((c) => ({
			id: c.id,
			...(c.node_id ? { nodeId: c.node_id } : {}),
			body: c.body,
			path: c.path,
			...(c.line != null ? { line: c.line } : {}),
		})),
		diff,
		opts.maxComments,
		opts.repoRoot,
		opts.readFile,
	);
	result.unplaced = plan.unplaced.map((finding) => ({
		finding,
		targetName: targetOf.get(finding.fingerprint) ?? "",
	}));

	try {
		for (const u of plan.update) {
			await client.rest.pulls.updateReviewComment({ ...repo, comment_id: u.id, body: u.body });
			result.updated += 1;
		}
		for (const c of plan.create) {
			try {
				await client.rest.pulls.createReviewComment({
					...repo,
					pull_number: pr.number,
					commit_id: pr.headSha,
					body: c.body,
					path: c.path,
					...(c.line !== undefined
						? { line: c.line, side: "RIGHT", subject_type: "line" }
						: { subject_type: "file" }),
				});
				result.created += 1;
			} catch (error) {
				if (isPermissionError(error)) throw error;
				// e.g. 422 "line could not be part of the diff": retry as a file-level comment, else list in the summary.
				if (c.line !== undefined) {
					try {
						await client.rest.pulls.createReviewComment({
							...repo,
							pull_number: pr.number,
							commit_id: pr.headSha,
							body: c.body,
							path: c.path,
							subject_type: "file",
						});
						result.created += 1;
						continue;
					} catch (retryError) {
						if (isPermissionError(retryError)) throw retryError;
					}
				}
				core.info(
					`Could not place an inline comment for ${c.finding.fingerprint} (${errorMessage(error)}); listing it in the summary.`,
				);
				result.unplaced.push({ finding: c.finding, targetName: targetOf.get(c.finding.fingerprint) ?? "" });
			}
		}
		if (plan.patch.length > 0) {
			let threads = new Map<number, string>();
			try {
				threads = await fetchThreadIds(client, pr);
			} catch (error) {
				warn(
					`Could not list review threads (${errorMessage(error)}); patched comments will be edited but not resolved.`,
				);
			}
			for (const p of plan.patch) {
				await client.rest.pulls.updateReviewComment({ ...repo, comment_id: p.id, body: p.body });
				result.patched += 1;
				const threadId = threads.get(p.id);
				if (!threadId) continue;
				try {
					await client.graphql(RESOLVE_MUTATION, { threadId });
					result.resolved += 1;
				} catch (error) {
					core.info(`Could not resolve thread for ${p.fingerprint}: ${errorMessage(error)}`);
				}
			}
		}
	} catch (error) {
		if (isPermissionError(error)) {
			warn(
				`Cannot write pull request review comments (${errorMessage(error)}). Grant \`pull-requests: write\` to the job.`,
			);
		} else {
			throw error;
		}
	}

	// Summary comment (issue comment), created or updated in place.
	const summaryBody = appendUnplaced(opts.summaryBody, result.unplaced);
	try {
		const issueComments = await paginate((page, per_page) =>
			client.rest.issues.listComments({ ...repo, issue_number: pr.number, per_page, page }),
		);
		const existingSummary = issueComments.find((c) => isSummaryComment(c.body));
		if (existingSummary) {
			await client.rest.issues.updateComment({ ...repo, comment_id: existingSummary.id, body: summaryBody });
			result.summary = "updated";
		} else {
			await client.rest.issues.createComment({ ...repo, issue_number: pr.number, body: summaryBody });
			result.summary = "created";
		}
	} catch (error) {
		if (isPermissionError(error)) {
			warn(
				`Cannot post the summary comment (${errorMessage(error)}). Grant \`pull-requests: write\` to the job.`,
			);
		} else {
			throw error;
		}
	}

	core.info(
		`PR comments: summary ${result.summary}, ${result.created} created, ${result.updated} updated, ${result.patched} patched (${result.resolved} threads resolved).`,
	);
	return result;
}

/** Append the list of new findings that did not get an inline comment. */
export function appendUnplaced(
	summaryBody: string,
	unplaced: Array<{ finding: Finding; targetName: string }>,
): string {
	if (unplaced.length === 0) return summaryBody;
	const lines: string[] = ["", "### Findings without an inline comment", ""];
	for (const { finding: f, targetName } of sortUnplaced(unplaced)) {
		const where = f.location?.file
			? `\`${f.location.file}${f.location.symbol ? `#${f.location.symbol}` : ""}\``
			: f.location?.selector
				? `\`${f.location.selector}\``
				: `\`${f.route}\``;
		lines.push(
			`- ${SEVERITY_ICON[f.severity]} **${f.severity}** [\`${f.rule}\`](${f.docsUrl}) ${targetName ? `${targetName} · ` : ""}${where} — ${f.title}`,
		);
	}
	return `${summaryBody}\n${lines.join("\n")}\n`;
}

function sortUnplaced<T extends { finding: Finding }>(items: T[]): T[] {
	const order = new Map(
		sortFindingsForDisplay(items.map((i) => i.finding)).map((f, i) => [f.fingerprint, i]),
	);
	return [...items].sort(
		(a, b) => (order.get(a.finding.fingerprint) ?? 0) - (order.get(b.finding.fingerprint) ?? 0),
	);
}
