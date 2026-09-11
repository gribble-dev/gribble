import * as core from "@actions/core";
import {
	type CheckAnnotation,
	errorMessage,
	type GitHubClient,
	isPermissionError,
	type RepoRef,
} from "./github.js";
import { type LocateOptions, locateFinding } from "./locate.js";
import type { Finding, FindingSeverity, LoadedReport } from "./types.js";

export const CHECK_NAME = "Gribble";
/** GitHub accepts at most 50 annotations per checks API call. */
export const ANNOTATIONS_PER_CALL = 50;

export function severityToAnnotationLevel(severity: FindingSeverity): CheckAnnotation["annotation_level"] {
	switch (severity) {
		case "critical":
		case "error":
			return "failure";
		case "warn":
			return "warning";
		default:
			return "notice";
	}
}

export function annotationMessage(f: Finding): string {
	const parts = [f.message || f.title];
	if (f.route) parts.push(`Route: ${f.route}${f.viewport ? ` (${f.viewport})` : ""}`);
	if (f.suggestion) parts.push(`Fix: ${f.suggestion}`);
	parts.push(f.docsUrl);
	return parts.join("\n");
}

/**
 * One annotation per new finding with a known file. Line comes from a text
 * search for `location.symbol`, else line 1.
 */
export function buildAnnotations(findings: Finding[], locate: LocateOptions): CheckAnnotation[] {
	const annotations: CheckAnnotation[] = [];
	for (const f of findings) {
		if (f.status !== "new" || !f.location?.file) continue;
		const loc = locateFinding(f, locate);
		if (!loc) continue;
		annotations.push({
			path: loc.path,
			start_line: loc.line,
			end_line: loc.line,
			annotation_level: severityToAnnotationLevel(f.severity),
			title: `${f.rule}: ${f.title}`,
			message: annotationMessage(f),
			raw_details: `fingerprint: ${f.fingerprint}`,
		});
	}
	return annotations;
}

export function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

export interface CreateCheckOptions {
	repo: RepoRef;
	headSha: string;
	conclusion: "success" | "failure" | "neutral";
	title: string;
	summary: string;
	text?: string;
	annotations: CheckAnnotation[];
	detailsUrl?: string;
}

/** Create the "Gribble" check run, batching annotations 50 per call. Returns the check run URL. */
export async function createCheckRun(
	client: GitHubClient,
	opts: CreateCheckOptions,
): Promise<string | undefined> {
	const batches = chunk(opts.annotations, ANNOTATIONS_PER_CALL);
	const first = batches.shift() ?? [];
	try {
		const created = await client.rest.checks.create({
			...opts.repo,
			name: CHECK_NAME,
			head_sha: opts.headSha,
			status: "completed",
			conclusion: opts.conclusion,
			...(opts.detailsUrl ? { details_url: opts.detailsUrl } : {}),
			output: {
				title: opts.title,
				summary: opts.summary,
				...(opts.text ? { text: opts.text } : {}),
				annotations: first,
			},
		});
		for (const batch of batches) {
			await client.rest.checks.update({
				...opts.repo,
				check_run_id: created.data.id,
				output: { title: opts.title, summary: opts.summary, annotations: batch },
			});
		}
		core.info(`Check run "${CHECK_NAME}" created with ${opts.annotations.length} annotation(s).`);
		return created.data.html_url ?? undefined;
	} catch (error) {
		if (isPermissionError(error)) {
			core.warning(
				`Could not create the "${CHECK_NAME}" check run (${errorMessage(error)}). Grant \`checks: write\` to the job, or use a token that has it.`,
			);
			// Fall back to workflow-command annotations so findings still show up.
			for (const a of opts.annotations) {
				const props = { title: a.title, file: a.path, startLine: a.start_line, endLine: a.end_line };
				if (a.annotation_level === "failure") core.error(a.message, props);
				else if (a.annotation_level === "warning") core.warning(a.message, props);
				else core.notice(a.message, props);
			}
			return undefined;
		}
		throw error;
	}
}

/** Collect new findings across reports with their target directories for file resolution. */
export function collectAnnotations(
	loaded: LoadedReport[],
	repoRoot: string,
	readFile?: LocateOptions["readFile"],
): CheckAnnotation[] {
	return loaded.flatMap((l) =>
		buildAnnotations(l.report.findings, {
			repoRoot,
			searchRoots: [l.targetDir],
			...(readFile ? { readFile } : {}),
		}),
	);
}
