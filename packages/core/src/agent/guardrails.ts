/**
 * Guardrails: pi has no permission system, so the shell adds one. Origin allow-list, side-effect
 * guard, step and token budgets, secret redaction, the deterministic-summary injection and the
 * `search_tools` loader for the inactive packs.
 */
import type { ExtensionAPI, InlineExtension, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { InteractiveElement } from "../browser/types.js";
import { matchOrigin } from "../util/index.js";
import { BROWSER_TOOLS, BUDGET_EXEMPT_TOOLS, LOADER_TOOL } from "./names.js";
import { redactValue } from "./redact.js";
import type { AgentState } from "./state.js";

/** Accessible names that smell like money, destruction or outbound messages. */
export const SIDE_EFFECT_PATTERN =
	/\b(pay(?:ment)?|purchase|buy now|place (?:your )?order|checkout|subscribe now|delete (?:my )?account|delete (?:all|everything)|send (?:e-?mail|message|invoice)|cancel (?:my )?subscription|transfer|withdraw|charge)\b/i;

/** Extra calls allowed after the step cap so the run can still be finalized. */
const BUDGET_GRACE = 25;

/** Hosts where side effects are acceptable: loopback, preview platforms, or names that say so. */
export function isSideEffectSafeHost(host: string, environment?: string): boolean {
	if (environment && /^(preview|staging|stage|dev|development|test|local)$/i.test(environment)) return true;
	if (
		matchOrigin(host, [
			"localhost",
			"*.vercel.app",
			"*.netlify.app",
			"*.pages.dev",
			"*.workers.dev",
			"*.ngrok.app",
			"*.ngrok.io",
			"*.localhost",
		])
	) {
		return true;
	}
	return /(^|[.-])(staging|stage|preview|dev|test|sandbox|qa)([.-]|$)/i.test(host);
}

export interface GuardrailsOptions {
	/** Tools active from the first turn; everything else registered stays inactive until searched. */
	initialTools: readonly string[];
}

function hostOf(url: string): string | undefined {
	try {
		return new URL(url).hostname;
	} catch {
		return undefined;
	}
}

function elementForTarget(state: AgentState, target: unknown): InteractiveElement | undefined {
	if (typeof target !== "string" || !state.lastSnapshot) return undefined;
	const ref = /^ref=(e\d+)$/i.exec(target.trim())?.[1];
	const elements = state.lastSnapshot.interactive;
	if (ref) return elements.find((el) => el.ref === ref);
	const text = /^text=(.*)$/i.exec(target.trim())?.[1]?.replace(/^["']|["']$/g, "");
	if (text) return elements.find((el) => el.name.trim().toLowerCase() === text.trim().toLowerCase());
	const role = /^role=([a-z]+)\[name=["']?(.+?)["']?\]$/i.exec(target.trim());
	if (role) return elements.find((el) => el.role === role[1] && el.name.trim() === role[2]?.trim());
	return elements.find((el) => el.selector === target || (el.testId && target.includes(el.testId)));
}

export function guardrails(state: AgentState, opts: GuardrailsOptions): InlineExtension {
	return {
		name: "gribble-guardrails",
		factory: (pi: ExtensionAPI) => {
			const allowedOrigins = () => {
				const targetHost = hostOf(state.config.target.url);
				return [...(targetHost ? [targetHost] : []), ...state.config.allowed_origins];
			};
			const isAllowedUrl = (url: string) => {
				const host = hostOf(url);
				if (!host) return true; // relative or unparsable: stays on the current origin
				return matchOrigin(host, allowedOrigins());
			};

			pi.on("session_start", () => {
				const all = pi.getAllTools();
				const registered = new Set(all.map((t) => t.name));
				const active = new Set(pi.getActiveTools());
				// Keep pi's built-ins the session was created with (read-only file tools), add the
				// initial pack tools, and leave every other pack tool registered but inactive.
				const builtins = all
					.filter((t) => t.sourceInfo.source === "builtin" && active.has(t.name))
					.map((t) => t.name);
				const wanted = [...new Set([...builtins, ...opts.initialTools])];
				const missing = opts.initialTools.filter((name) => !registered.has(name));
				if (missing.length) state.log("debug", `Tools not registered in this session: ${missing.join(", ")}`);
				pi.setActiveTools(wanted.filter((name) => registered.has(name)));
			});

			let summaryInjected = false;
			pi.on("before_agent_start", () => {
				if (summaryInjected || !state.deterministicSummary?.trim()) return undefined;
				summaryInjected = true;
				return {
					message: {
						customType: "gribble-deterministic-summary",
						content: `## Deterministic results\n\nThese checks already ran in code. Do not re-report them; use them as context.\n\n${state.deterministicSummary.trim()}`,
						display: true,
					},
				};
			});

			pi.on("tool_call", (event: ToolCallEvent, ctx) => {
				if (state.terminated) {
					return { block: true, reason: "The audit has ended.", terminate: true };
				}
				redactValue(event.input, state.secrets);

				state.usage.steps++;
				const over = state.usage.steps > state.budget.maxSteps;
				if (over) {
					const exempt = BUDGET_EXEMPT_TOOLS.has(event.toolName);
					const hardStop = state.usage.steps > state.budget.maxSteps + BUDGET_GRACE;
					if (!exempt || hardStop) {
						if (!state.budget.exhausted) {
							state.budget.exhausted = true;
							state.budget.reason = `step budget of ${state.budget.maxSteps} reached`;
							state.log(
								"warn",
								`Step budget of ${state.budget.maxSteps} reached; asking the model to finalize.`,
							);
						}
						state.emitBudget();
						if (hardStop) {
							state.terminated = true;
							return { block: true, reason: "Step budget exhausted. The audit has ended.", terminate: true };
						}
						if (!state.budget.noticeSent) {
							state.budget.noticeSent = true;
							pi.sendMessage(
								{
									customType: "gribble-budget",
									content:
										"The step budget for this audit is spent. Do not call any more browser or check tools. Call finalize_report immediately with a summary of what you covered.",
									display: true,
								},
								{ deliverAs: "steer", triggerTurn: true },
							);
						}
						return {
							block: true,
							reason: `Step budget of ${state.budget.maxSteps} reached. Call finalize_report now.`,
							terminate: true,
						};
					}
				}

				if (event.toolName === BROWSER_TOOLS.navigate) {
					const raw = event.input.url;
					if (typeof raw === "string") {
						let resolved: string;
						try {
							resolved = state.resolveUrl(raw);
						} catch {
							return { block: true, reason: `Cannot parse URL "${raw}".` };
						}
						if (!isAllowedUrl(resolved)) {
							return {
								block: true,
								reason: `Navigation to ${hostOf(resolved)} is blocked. Allowed origins: ${allowedOrigins().join(", ")}.`,
							};
						}
					}
				}

				if (event.toolName === BROWSER_TOOLS.click || event.toolName === BROWSER_TOOLS.fill) {
					const el = elementForTarget(state, event.input.target);
					if (event.toolName === BROWSER_TOOLS.click && el?.href) {
						let resolved: string | undefined;
						try {
							resolved = new URL(el.href, state.lastSnapshot?.url ?? state.config.target.url).toString();
						} catch {
							resolved = undefined;
						}
						if (resolved && !/^(javascript|mailto|tel):/i.test(el.href) && !isAllowedUrl(resolved)) {
							return {
								block: true,
								reason: `That link leaves the allowed origins (${hostOf(resolved)}). Skip it and note it as an external link.`,
							};
						}
					}
					const name =
						el?.name ?? (typeof event.input.description === "string" ? event.input.description : "");
					if (name && SIDE_EFFECT_PATTERN.test(name)) {
						const pageUrl = state.pages.get(state.currentViewport)?.url() ?? state.config.target.url;
						const host = hostOf(pageUrl) ?? "";
						if (!isSideEffectSafeHost(host, state.project.environment)) {
							return {
								block: true,
								reason: `"${name}" looks like a real side effect (payment, deletion or sending) on ${host}. Blocked outside preview/staging. Report the state up to this point instead.`,
							};
						}
					}
				}

				state.emitBudget();
				void ctx;
				return undefined;
			});

			pi.on("tool_result", (event) => {
				if (state.secrets.length === 0) return undefined;
				let changed = false;
				const content = event.content.map((part) => {
					if (part.type !== "text") return part;
					const text = redactValue(part.text, state.secrets);
					if (text !== part.text) changed = true;
					return { ...part, text };
				});
				return changed ? { content } : undefined;
			});

			pi.on("turn_end", (event, ctx) => {
				const message = event.message as {
					role?: string;
					usage?: { totalTokens?: number; input?: number; output?: number; cost?: { total?: number } };
				};
				if (message.role !== "assistant" || !message.usage) return;
				state.usage.tokens += message.usage.totalTokens ?? 0;
				state.usage.input += message.usage.input ?? 0;
				state.usage.output += message.usage.output ?? 0;
				state.usage.costUsd += message.usage.cost?.total ?? 0;
				state.emitBudget();
				if (state.budget.exhausted) return;
				if (state.usage.tokens > state.budget.maxTokens) {
					state.budget.exhausted = true;
					state.budget.reason = `token budget of ${state.budget.maxTokens} exceeded (${state.usage.tokens})`;
				} else if (state.budget.maxCostUsd !== undefined && state.usage.costUsd > state.budget.maxCostUsd) {
					state.budget.exhausted = true;
					state.budget.reason = `cost budget of $${state.budget.maxCostUsd} exceeded ($${state.usage.costUsd.toFixed(2)})`;
				}
				if (state.budget.exhausted) {
					state.terminated = true;
					state.log("warn", `${state.budget.reason}; stopping the review with what was collected.`);
					ctx.abort();
				}
			});

			pi.registerTool({
				name: LOADER_TOOL,
				label: "Search tools",
				description:
					"Find and enable additional tools by keyword: link checking, Lighthouse, axe, SEO meta, sitemap, robots, screenshot comparison, design tokens. Enabled tools stay available for the rest of the session.",
				promptSnippet: "Search for and enable additional audit tools when the active ones cannot do the job",
				promptGuidelines: [
					'Use search_tools when a task needs a check that no active tool covers, e.g. `search_tools({ query: "lighthouse" })`.',
				],
				parameters: Type.Object({
					query: Type.String({
						description: "Capability or task, e.g. `broken links`, `accessibility`, `sitemap`.",
					}),
					limit: Type.Optional(
						Type.Integer({ description: "Max tools to enable, default 3.", minimum: 1, maximum: 10 }),
					),
				}),
				async execute(_id, params) {
					const active = new Set(pi.getActiveTools());
					const terms = params.query
						.toLowerCase()
						.split(/[^a-z0-9]+/)
						.filter(Boolean);
					const candidates = pi
						.getAllTools()
						.filter((tool) => !active.has(tool.name) && tool.sourceInfo.source !== "builtin")
						.map((tool) => {
							const haystack = `${tool.name.replace(/_/g, " ")} ${tool.description}`.toLowerCase();
							const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
							return { tool, score };
						})
						.filter((m) => m.score > 0)
						.sort((a, b) => b.score - a.score)
						.slice(0, params.limit ?? 3);
					if (candidates.length === 0) {
						const inactive = pi
							.getAllTools()
							.filter((tool) => !active.has(tool.name) && tool.sourceInfo.source !== "builtin")
							.map((tool) => `- ${tool.name}: ${tool.description.split(". ")[0]}`);
						return {
							content: [
								{
									type: "text",
									text: `No tool matches "${params.query}".${inactive.length ? ` Inactive tools:\n${inactive.join("\n")}` : ""}`,
								},
							],
							details: { matches: [], added: [] },
						};
					}
					const added = candidates.map((m) => m.tool.name);
					pi.setActiveTools([...new Set([...active, ...added])]);
					return {
						content: [
							{
								type: "text",
								text: `Enabled: ${added.join(", ")}.\n${candidates.map((m) => `- ${m.tool.name}: ${m.tool.description}`).join("\n")}`,
							},
						],
						details: { matches: added, added },
					};
				},
			});
		},
	};
}
