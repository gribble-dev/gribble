import path from "node:path";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { uploadReportArtifact } from "./artifacts.js";
import { isPushToDefaultBranch, writeBackBaseline } from "./baseline.js";
import { collectAnnotations, createCheckRun } from "./checks.js";
import { syncComments } from "./comments.js";
import { loadFormatters } from "./core.js";
import { checkConclusion, decideFailure } from "./fail.js";
import { errorMessage, type GitHubClient } from "./github.js";
import { InputError, parseInputs } from "./inputs.js";
import { setActionOutputs, writeOutputFiles } from "./outputs.js";
import { ReportError } from "./report.js";
import { AuditError, runAudit } from "./run-audit.js";
import { buildSummaryMarkdown, checkTitle } from "./summary.js";

async function main(): Promise<void> {
	const inputs = parseInputs((name) => core.getInput(name));
	const repoRoot = path.resolve(process.env.GITHUB_WORKSPACE ?? process.cwd());
	const workingDirectory = path.resolve(repoRoot, inputs.workingDirectory || ".");
	const ctx = github.context;
	const client = github.getOctokit(inputs.githubToken) as unknown as GitHubClient;
	const pull = ctx.payload.pull_request as { number: number; head: { sha: string } } | undefined;
	const headSha = pull?.head.sha ?? ctx.sha;
	const defaultBranch =
		(ctx.payload.repository as { default_branch?: string } | undefined)?.default_branch ?? "main";

	// 1. Audit
	core.startGroup("Audit");
	const run = await runAudit(inputs, { workingDirectory, repoRoot });
	core.endGroup();
	const { loaded } = run;
	const newFindings = loaded.reduce((n, l) => n + l.report.summary.newCount, 0);
	const gate: "pass" | "fail" = loaded.some((l) => l.report.summary.gate === "fail") ? "fail" : "pass";
	const decision = decideFailure(
		loaded.map((l) => l.report),
		inputs.failOn,
	);
	for (const l of loaded) {
		core.info(
			`${l.report.target.name || l.report.target.url}: ${l.report.summary.headline || `gate ${l.report.summary.gate}`}`,
		);
	}

	// 2. SARIF / JUnit + outputs
	const formatters = await loadFormatters(workingDirectory);
	const files = await writeOutputFiles(loaded, formatters);
	setActionOutputs({ gate, newFindings, reportPath: files.reportPath, sarifPath: files.sarifPath });

	// 3. Artifact (first, so the summary can link to it)
	let reportUrl: string | undefined;
	if (inputs.reportArtifact) {
		const upload = await uploadReportArtifact({
			loaded,
			extraFiles: [files.sarifPath, files.junitPath, files.reportPath],
			rootDirectory: repoRoot,
			serverUrl: ctx.serverUrl,
			repo: ctx.repo,
			runId: ctx.runId,
		});
		reportUrl = upload?.url;
	}
	if (!reportUrl) reportUrl = `${ctx.serverUrl}/${ctx.repo.owner}/${ctx.repo.repo}/actions/runs/${ctx.runId}`;

	// 4. Check run with annotations
	let checkUrl: string | undefined;
	try {
		const annotations = collectAnnotations(loaded, repoRoot);
		const summary = buildSummaryMarkdown(loaded, formatters, {
			maxComments: inputs.maxComments,
			reportUrl,
			decision,
			failOn: inputs.failOn,
		});
		checkUrl = await createCheckRun(client, {
			repo: ctx.repo,
			headSha,
			conclusion: checkConclusion(
				loaded.map((l) => l.report),
				decision,
			),
			title: checkTitle(loaded, decision),
			summary,
			annotations,
			detailsUrl: reportUrl,
		});
	} catch (error) {
		core.warning(`Check run failed: ${errorMessage(error)}`);
	}

	// 5. PR comments
	const bootstrap = loaded.every((l) => l.report.baseline.bootstrap);
	if (pull && inputs.comment && !bootstrap) {
		try {
			const summaryBody = buildSummaryMarkdown(loaded, formatters, {
				maxComments: inputs.maxComments,
				reportUrl,
				decision,
				failOn: inputs.failOn,
				...(checkUrl ? { checkUrl } : {}),
			});
			await syncComments({
				client,
				pr: { ...ctx.repo, number: pull.number, headSha },
				loaded,
				summaryBody,
				maxComments: inputs.maxComments,
				repoRoot,
			});
		} catch (error) {
			core.warning(`PR comment sync failed: ${errorMessage(error)}`);
		}
	} else if (pull && bootstrap) {
		core.info(
			"Bootstrap run (no baseline yet): skipping PR comments. Commit .gribble/baseline/ to enable them.",
		);
	}

	// 6. Baseline write-back on the default branch
	if (
		inputs.updateBaseline &&
		isPushToDefaultBranch({ eventName: ctx.eventName, ref: ctx.ref, defaultBranch })
	) {
		try {
			await writeBackBaseline({
				client,
				repo: ctx.repo,
				repoRoot,
				loaded,
				sha: ctx.sha,
				defaultBranch,
				...(inputs.environment ? { environment: inputs.environment } : {}),
				serverUrl: ctx.serverUrl,
				runId: ctx.runId,
			});
		} catch (error) {
			core.warning(`Baseline write-back failed: ${errorMessage(error)}`);
		}
	} else if (inputs.updateBaseline) {
		core.info("update-baseline is set but this is not a push to the default branch; baseline left as is.");
	}

	// 7. fail-on
	if (decision.fail) {
		core.setFailed(`The gribbles found holes in your hull: ${decision.reason}`);
	} else {
		core.info(
			newFindings === 0 ? "The gribbles went hungry. Ship it." : `${decision.reason} Ship when ready.`,
		);
	}
}

main().catch((error: unknown) => {
	if (error instanceof InputError || error instanceof ReportError || error instanceof AuditError) {
		core.setFailed(error.message);
		return;
	}
	core.setFailed(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
