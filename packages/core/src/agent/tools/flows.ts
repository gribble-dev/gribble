/**
 * Flows pack: mark the start and end of a journey so the browser actions in between become a
 * replay sidecar, and propose journeys worth recording.
 */
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { describeValidationErrors } from "../../config/errors.js";
import { FLOWS_DIR, replaySidecarPath } from "../../flows/load.js";
import { type FlowReplay, type FlowStep, flowReplaySchema } from "../../flows/schema.js";
import { FLOW_TOOLS } from "../names.js";
import type { AgentState } from "../state.js";
import { textResult } from "./common.js";

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/** `Checkout happy path` -> `checkout-happy-path`. */
export function flowSlug(name: string): string {
	return (
		name
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "flow"
	);
}

/**
 * `url` as a path when it is on the target's origin, so a sidecar survives `--env` switches;
 * `about:blank` becomes the target's own path and paths stay paths.
 */
export function relativeToTarget(url: string, targetUrl: string): string {
	try {
		const target = new URL(targetUrl);
		const parsed = new URL(url, target);
		if (parsed.protocol === "about:") return target.pathname;
		if (parsed.origin !== target.origin) return url;
		return `${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return url;
	}
}

/**
 * Where a recorded replay starts. A flow whose first step navigates positions itself, so it starts
 * at the target root and the page the agent happened to be on is not recorded; otherwise the page
 * the flow started on, relative to the target.
 */
export function replayStartUrl(
	recording: { startUrl: string; steps: FlowStep[] },
	targetUrl: string,
): string {
	if (recording.steps[0]?.action === "navigate") return relativeToTarget(targetUrl, targetUrl);
	return relativeToTarget(recording.startUrl, targetUrl);
}

/** Build a replay from a recording and validate it against the schema. */
export function buildReplay(recording: {
	name: string;
	startUrl: string;
	steps: FlowReplay["steps"];
}): FlowReplay {
	const replay: FlowReplay = {
		version: 1,
		name: recording.name,
		startUrl: recording.startUrl,
		steps: recording.steps,
	};
	if (!Value.Check(flowReplaySchema, replay)) {
		const { path, message } = describeValidationErrors(Value.Errors(flowReplaySchema, replay));
		throw new Error(`Recorded flow is not a valid replay: ${message}${path ? ` at ${path}` : ""}`);
	}
	return replay;
}

export function flowsPack(state: AgentState): InlineExtension {
	return {
		name: "gribble-flows",
		factory: (pi: ExtensionAPI) => {
			pi.registerTool({
				name: FLOW_TOOLS.flowStart,
				label: "Flow start",
				description:
					"Mark the start of a flow from flows/*.md (or a new one you are exploring). Browser actions until flow_end are recorded as a replay.",
				promptSnippet: "Mark the start of a flow you are about to walk",
				parameters: Type.Object({
					name: Type.String({ description: "Flow name, exactly as listed in the prompt for known flows." }),
				}),
				async execute(_id, params) {
					if (state.flowRecording) {
						const previous = state.flowRecording.name;
						state.flowRecording = undefined;
						state.flowResults.push({
							name: previous,
							ok: false,
							kind: "ai",
							durationMs: 0,
							error: `flow_start("${params.name}") was called before flow_end("${previous}")`,
						});
						state.emit({ type: "flow:end", flow: previous, ok: false, error: "not ended" });
					}
					const page = await state.currentPage();
					const startUrl = relativeToTarget(page.url(), state.config.target.url);
					state.flowRecording = {
						name: params.name,
						startUrl,
						steps: [],
						problems: [],
						startedAt: Date.now(),
					};
					state.emit({ type: "flow:start", flow: params.name });
					return textResult(`Recording flow "${params.name}" from ${startUrl}.`, {
						name: params.name,
						startUrl,
					});
				},
			});

			pi.registerTool({
				name: FLOW_TOOLS.flowEnd,
				label: "Flow end",
				description:
					"Mark the end of the flow started with flow_start. Say whether the journey succeeded; on failure explain what blocked it. A successful known flow without a replay gets one written.",
				promptSnippet: "Mark the end of a flow and report whether it succeeded",
				parameters: Type.Object({
					name: Type.String({ description: "Flow name passed to flow_start." }),
					ok: Type.Boolean({ description: "true when the journey completed as described." }),
					error: Type.Optional(Type.String({ description: "What went wrong, when ok is false." })),
				}),
				async execute(_id, params) {
					const recording = state.flowRecording;
					if (!recording)
						throw new Error(`No flow is being recorded; call flow_start("${params.name}") first.`);
					if (recording.name !== params.name) {
						throw new Error(`Flow "${recording.name}" is being recorded, not "${params.name}".`);
					}
					state.flowRecording = undefined;
					const durationMs = Date.now() - recording.startedAt;
					const result = {
						name: params.name,
						ok: params.ok,
						kind: "ai" as const,
						durationMs,
						error: params.ok ? undefined : (params.error ?? "flow failed"),
						steps: recording.steps.length,
					};
					state.flowResults.push(result);
					state.emit({ type: "flow:end", flow: params.name, ok: params.ok, durationMs, error: result.error });

					let written: string | undefined;
					let skipped: string | undefined;
					if (params.ok && state.recordReplays && recording.steps.length > 0) {
						const known = state.flows.find((f) => f.name === params.name);
						const sidecar = known
							? replaySidecarPath(known.file)
							: join(state.project.gribbleDir, FLOWS_DIR, `${flowSlug(params.name)}.replay.json`);
						// An existing replay is never overwritten.
						const hasReplay = !!known?.replay || (await exists(sidecar));
						if (!hasReplay && recording.problems.length > 0) {
							// A sidecar that cannot replay would fail the next gate as flows/replay.
							skipped = `Replay not written to ${sidecar}: ${recording.problems.join("; ")}.`;
							state.log("warn", `flow ${params.name}: ${skipped}`);
						} else if (!hasReplay) {
							const replay = buildReplay({
								...recording,
								startUrl: replayStartUrl(recording, state.config.target.url),
							});
							await mkdir(join(sidecar, ".."), { recursive: true });
							await writeFile(sidecar, `${JSON.stringify(replay, null, 2)}\n`, "utf8");
							state.replaysWritten.push(sidecar);
							written = sidecar;
						}
					}
					const verdict = params.ok ? "succeeded" : `failed: ${result.error}`;
					return textResult(
						`Flow "${params.name}" ${verdict} after ${recording.steps.length} recorded step(s).${written ? ` Replay written to ${written}.` : ""}${skipped ? ` ${skipped}` : ""}`,
						{ ...result, replay: written, replaySkipped: skipped },
					);
				},
			});

			pi.registerTool({
				name: FLOW_TOOLS.proposeFlow,
				label: "Propose flow",
				description:
					"Propose a user journey worth recording as a gate flow. Writes flows/proposed/<name>.md for a human to review; report the gap with add_finding under review/flow-coverage as well.",
				promptSnippet: "Propose a journey that should become a recorded flow",
				parameters: Type.Object({
					name: Type.String({ description: "Short flow name, e.g. `checkout`." }),
					description: Type.String({
						description: "Markdown steps a tester would follow, plus what success looks like.",
					}),
					requires_auth: Type.Optional(
						Type.String({ description: "Auth profile the flow needs, when it starts logged in." }),
					),
				}),
				async execute(_id, params) {
					const dir = join(state.project.gribbleDir, FLOWS_DIR, "proposed");
					await mkdir(dir, { recursive: true });
					const file = join(dir, `${flowSlug(params.name)}.md`);
					const frontmatter = [`name: ${params.name}`];
					if (params.requires_auth) frontmatter.push(`requires_auth: ${params.requires_auth}`);
					frontmatter.push("tags: [proposed]");
					const body = `---\n${frontmatter.join("\n")}\n---\n\n${params.description.trim()}\n`;
					await writeFile(file, body, "utf8");
					state.proposedFlows.push(file);
					return textResult(
						`Proposed flow written to ${file}. Move it up one directory to make it a real flow.`,
						{
							file,
							name: params.name,
						},
					);
				},
			});
		},
	};
}
