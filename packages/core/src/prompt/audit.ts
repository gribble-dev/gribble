import type { AuditMode } from "../config/types.js";
import type { Flow } from "../flows/schema.js";
import type { ProjectContext } from "../project/types.js";

const MODE_TASK: Record<AuditMode, string> = {
	gate: "Gate run: deterministic checks and recorded flow replays are the verdict. Read the deterministic results below, add findings only for problems they surfaced that need explanation, and finalize. Do not explore.",
	review:
		"Review run: walk every flow listed below, then explore the routes for problems a user would notice. Judge against the project guidelines. Deterministic checks are not your job.",
	all: "Full run: deterministic results are below for context. Walk every flow, then explore the routes and judge against the project guidelines. Do not re-report what the deterministic checks already found.",
};

function describeFlow(flow: Flow): string {
	const meta: string[] = [];
	if (flow.requiresAuth)
		meta.push(`requires auth: ${flow.requiresAuth === true ? "default profile" : flow.requiresAuth}`);
	if (flow.tags?.length) meta.push(`tags: ${flow.tags.join(", ")}`);
	if (flow.env?.length) meta.push(`environments: ${flow.env.join(", ")}`);
	if (flow.replay) meta.push(`has a recorded replay (${flow.replay.steps.length} steps)`);
	const head = `### ${flow.name}${meta.length ? ` (${meta.join("; ")})` : ""}`;
	return `${head}\n\n${flow.description || "_No description._"}`;
}

/** The first user message of an audit session. */
export function buildAuditPrompt(opts: {
	project: ProjectContext;
	mode: AuditMode;
	deterministicSummary?: string;
	routes: string[];
	flows: Flow[];
}): string {
	const { project, mode, routes, flows } = opts;
	const out: string[] = [];
	out.push(`# Audit ${project.targetName ? `\`${project.targetName}\`` : "this site"}`);
	out.push("");
	out.push(MODE_TASK[mode]);
	out.push("");
	out.push("## Target");
	out.push("");
	out.push(`- URL: ${project.config.target.url}`);
	if (project.environment) out.push(`- Environment: ${project.environment}`);
	if (project.targetName) out.push(`- App: ${project.targetName}`);
	out.push(
		`- Viewports: ${Object.entries(project.config.viewports)
			.map(([name, v]) => `${name} (${v.width}x${v.height})`)
			.join(", ")}`,
	);
	out.push("");

	out.push("## Routes");
	out.push("");
	if (routes.length === 0)
		out.push("_No routes were discovered; start at the target URL and follow the navigation._");
	for (const route of routes) out.push(`- ${route}`);
	out.push("");

	if (mode !== "gate") {
		out.push("## Flows to walk");
		out.push("");
		if (flows.length === 0) {
			out.push(
				"_No flows are defined. Walk the primary navigation and report journeys worth recording under `review/flow-coverage`._",
			);
		} else {
			out.push(...flows.map(describeFlow).join("\n\n").split("\n"));
		}
		out.push("");
	}

	if (opts.deterministicSummary?.trim()) {
		out.push("## Deterministic results");
		out.push("");
		out.push(opts.deterministicSummary.trim());
		out.push("");
	}

	out.push("## Finish");
	out.push("");
	out.push(
		"Report each problem with `add_finding` as you go. When every flow is walked and the routes are covered (or the budget runs low), call `finalize_report` with a two-sentence summary of what you checked.",
	);
	return `${out.join("\n")}\n`;
}
