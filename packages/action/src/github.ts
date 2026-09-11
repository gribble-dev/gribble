/**
 * The narrow slice of Octokit the action uses, so tests can pass plain mocks
 * and production can pass `getOctokit(token)` unchanged.
 */

export interface RepoRef {
	owner: string;
	repo: string;
}

export interface IssueCommentRecord {
	id: number;
	body?: string | null;
	node_id?: string;
}

export interface ReviewCommentRecord {
	id: number;
	node_id?: string;
	body: string;
	path: string;
	line?: number | null;
	original_line?: number | null;
}

export interface PullFileRecord {
	filename: string;
	status?: string;
	patch?: string;
}

export interface CheckRunOutput {
	title: string;
	summary: string;
	text?: string;
	annotations?: CheckAnnotation[];
}

export interface CheckAnnotation {
	path: string;
	start_line: number;
	end_line: number;
	annotation_level: "notice" | "warning" | "failure";
	message: string;
	title?: string;
	raw_details?: string;
}

export interface GitHubClient {
	rest: {
		checks: {
			create(
				params: RepoRef & {
					name: string;
					head_sha: string;
					status: "completed";
					conclusion: "success" | "failure" | "neutral";
					details_url?: string;
					output: CheckRunOutput;
				},
			): Promise<{ data: { id: number; html_url?: string | null } }>;
			update(params: RepoRef & { check_run_id: number; output: CheckRunOutput }): Promise<unknown>;
		};
		issues: {
			listComments(
				params: RepoRef & { issue_number: number; per_page?: number; page?: number },
			): Promise<{ data: IssueCommentRecord[] }>;
			createComment(
				params: RepoRef & { issue_number: number; body: string },
			): Promise<{ data: IssueCommentRecord }>;
			updateComment(params: RepoRef & { comment_id: number; body: string }): Promise<unknown>;
		};
		pulls: {
			listFiles(
				params: RepoRef & { pull_number: number; per_page?: number; page?: number },
			): Promise<{ data: PullFileRecord[] }>;
			listReviewComments(
				params: RepoRef & { pull_number: number; per_page?: number; page?: number },
			): Promise<{ data: ReviewCommentRecord[] }>;
			createReviewComment(
				params: RepoRef & {
					pull_number: number;
					body: string;
					commit_id: string;
					path: string;
					line?: number;
					side?: "LEFT" | "RIGHT";
					subject_type?: "line" | "file";
				},
			): Promise<{ data: ReviewCommentRecord }>;
			updateReviewComment(params: RepoRef & { comment_id: number; body: string }): Promise<unknown>;
			create(
				params: RepoRef & { title: string; head: string; base: string; body?: string },
			): Promise<{ data: { number: number; html_url?: string } }>;
		};
	};
	graphql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

/** Fetch every page of a list endpoint (100 per page). */
export async function paginate<T>(
	fetchPage: (page: number, perPage: number) => Promise<{ data: T[] }>,
	perPage = 100,
): Promise<T[]> {
	const all: T[] = [];
	for (let page = 1; page < 100; page += 1) {
		const { data } = await fetchPage(page, perPage);
		all.push(...data);
		if (data.length < perPage) break;
	}
	return all;
}

/** True for 403/404 responses that indicate a missing token permission. */
export function isPermissionError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const status = (error as { status?: number }).status;
	const message = String((error as { message?: string }).message ?? "");
	return status === 403 || /Resource not accessible by integration/i.test(message);
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
