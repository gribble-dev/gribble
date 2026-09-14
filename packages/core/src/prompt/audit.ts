import type { AuditMode } from "../config/types.js";
import type { Flow } from "../flows/schema.js";
import type { ProjectContext } from "../project/types.js";

const MODE_TASK: Record<AuditMode, string> = {
	gate: "Gate run: deterministic checks and recorded flow replays are the verdict. Read the deterministic results below, add findings only for problems they surfaced that need explanation, and finalize. Do not explore.",
	review:
		"Review run: walk every flow listed below to completion first, then cover the routes, and only then explore. Judge against the project guidelines. Deterministic checks are not your job.",
	all: "Full run: deterministic results are below for context. Walk every flow to completion first, then cover the routes, and only then explore. Do not re-report what the deterministic checks already found.",
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

	if (mode !== "gate") {
		const steps = project.config.budget.max_steps;
		const flowCount = flows.length;
		out.push("## Plan (follow this order, do not skip ahead)");
		out.push("");
		out.push(
			`1. **Flows first.** For each flow above, in order: call \`flow_start\`, perform the described steps with the browser tools, verify the expected outcome, then call \`flow_end\` with \`ok\` and, when it failed, \`error\`. A flow is not walked until \`flow_end\` was called. Do not read source files, open unrelated routes or add exploratory findings before every flow has ended. ${flowCount > 0 ? `Budget about ${Math.max(6, Math.floor((steps * 0.4) / flowCount))} steps per flow.` : ""}`,
		);
		out.push(
			"2. **Route pass.** Visit each listed route once: `navigate`, `page_snapshot`, judge it against the guidelines, `add_finding` for what you see. One snapshot per route per viewport is enough.",
		);
		out.push(
			`3. **Explore only with what is left.** If fewer than ${Math.round(steps * 0.6)} steps are used after the route pass, follow links you have not seen, try empty and error states, switch viewports. Stop exploring at ${Math.round(steps * 0.85)} steps no matter what.`,
		);
		out.push(
			"4. **Finalize.** Call `finalize_report` with a two-sentence summary. Reserve the last 10% of the budget for it; a run that ends without it is a failed run.",
		);
		out.push("");
		out.push(
			"Use `read`, `grep` and `find` only to pin a finding you are about to add to a file and symbol (prefer `map_dom_to_source`). Never browse the repository to understand the product; the pages are the product.",
		);
		out.push("");
	}

	out.push("## Finish");
	out.push("");
	out.push(
		"Report each problem with `add_finding` as you go. When every flow has ended and the routes are covered, or when Gribble tells you the budget is running low, call `finalize_report` with a two-sentence summary of what you checked.",
	);
	return `${out.join("\n")}\n`;
}
