/**
 * Browser pack: the model's hands and eyes. One `AuditPage` per viewport, shared across calls.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { InteractiveElement } from "../../browser/types.js";
import { truncate } from "../../checks/finding.js";
import { formatSnapshot } from "../format.js";
import { BROWSER_TOOLS } from "../names.js";
import type { AgentState } from "../state.js";
import { minFontPx, refOf, StringEnum, snapshotTokensFor, textResult } from "./common.js";

const TARGET_DESCRIPTION =
	"`ref=e12` from the last page_snapshot, or a Playwright selector: `text=Sign in`, `role=button[name=Save]`, or CSS.";

/** A value quoted for a selector attribute: `"a \"b\""`. */
function quoted(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** A link href that survives `--env` switches: a path, not an absolute URL, a fragment or a script. */
function stableHref(href: string | undefined): string | undefined {
	if (!href || href.startsWith("#") || href.startsWith("//")) return undefined;
	if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return undefined;
	return href;
}

/**
 * Selectors that could replay a click or fill on `el`, most stable first: test id, id, the href of
 * a link, the role and full accessible name, then the structural path.
 */
export function replaySelectorCandidates(el: InteractiveElement): string[] {
	const out: string[] = [];
	if (el.testId) out.push(`[data-testid=${quoted(el.testId)}]`);
	if (el.id) out.push(/^[A-Za-z][\w-]*$/.test(el.id) ? `#${el.id}` : `[id=${quoted(el.id)}]`);
	const href = el.role === "link" ? stableHref(el.href) : undefined;
	if (href) out.push(`${el.tag === "a" ? "a" : ""}[href=${quoted(href)}]`);
	if (el.role && el.name) out.push(`role=${el.role}[name=${quoted(el.name)}]`);
	if (el.selector) out.push(el.selector);
	return [...new Set(out)];
}

export interface ReplaySelector {
	selector: string;
	/** Why the selector may not replay; set when no candidate resolved to the element on the live page. */
	problem?: string;
}

/**
 * The selector a flow recording keeps for `target`. Refs are turned into a candidate that matches
 * exactly one element on the live page, and that element is the one behind the ref; a candidate whose
 * first match is the element comes next, since replays act on the first match.
 */
export async function selectorForReplay(state: AgentState, target: string): Promise<ReplaySelector> {
	const ref = refOf(target);
	if (!ref) return { selector: target };
	const page = await state.currentPage();
	const el = await page.resolveRef(ref);
	if (!el) return { selector: target, problem: `ref ${ref} is not in the last page_snapshot` };
	const candidates = replaySelectorCandidates(el);
	const fallback = candidates[0] ?? el.selector;
	if (!state.flowRecording || !page.matchSelector) return { selector: fallback };
	let firstMatch: string | undefined;
	for (const candidate of candidates) {
		const match = await page.matchSelector(candidate, ref);
		if (!match.sameElement) continue;
		if (match.count === 1) return { selector: candidate };
		firstMatch ??= candidate;
	}
	if (firstMatch) return { selector: firstMatch };
	return {
		selector: fallback,
		problem: `no selector for ${ref}${el.name ? ` "${truncate(el.name, 60)}"` : ""} resolves to it on the live page`,
	};
}

export function browserPack(state: AgentState): InlineExtension {
	return {
		name: "gribble-browser",
		factory: (pi: ExtensionAPI) => {
			pi.registerTool({
				name: BROWSER_TOOLS.navigate,
				label: "Navigate",
				description:
					"Open a URL or path in the current viewport. Relative paths resolve against the target URL. Returns the final URL, HTTP status and title. Only allowed origins can be opened.",
				promptSnippet: "Open a page in the browser",
				parameters: Type.Object({
					url: Type.String({ description: "Absolute URL or a path such as /pricing." }),
					waitUntil: Type.Optional(
						StringEnum(["load", "domcontentloaded", "networkidle"] as const, {
							description: "When to consider the navigation done. Default: load.",
						}),
					),
				}),
				async execute(_id, params, _signal, onUpdate) {
					const url = state.resolveUrl(params.url);
					onUpdate?.({ content: [{ type: "text", text: `Opening ${url}` }], details: { url } });
					const page = await state.currentPage();
					const result = await page.goto(url, { waitUntil: params.waitUntil });
					const route = state.trackUrl(result.finalUrl);
					state.recordStep({ action: "navigate", url: params.url });
					const title = await page.text("title").catch(() => "");
					const status = result.status ?? "n/a";
					const text = `${result.ok ? "Opened" : "Failed to open"} ${result.finalUrl} (status ${status})${title ? ` — "${title.trim()}"` : ""}${result.error ? `\nerror: ${result.error}` : ""}\nroute: ${route}`;
					if (!result.ok && result.error) throw new Error(text);
					return textResult(text, { ...result, route, title: title.trim() });
				},
			});

			pi.registerTool({
				name: BROWSER_TOOLS.click,
				label: "Click",
				description:
					"Click an element. Take a page_snapshot afterwards to see what changed. Clicks that would leave the allowed origins or trigger payments, deletions or sending are blocked.",
				promptSnippet: "Click an element on the page",
				parameters: Type.Object({
					target: Type.String({ description: TARGET_DESCRIPTION }),
					description: Type.Optional(
						Type.String({
							description: "What the click does, e.g. `open pricing`. Kept in flow recordings.",
						}),
					),
				}),
				async execute(_id, params, _signal, onUpdate) {
					const page = await state.currentPage();
					const { selector, problem } = await selectorForReplay(state, params.target);
					onUpdate?.({ content: [{ type: "text", text: `Clicking ${params.target}` }], details: {} });
					await page.click(params.target);
					state.recordStep({ action: "click", selector, description: params.description }, problem);
					const url = page.url();
					const route = state.trackUrl(url);
					return textResult(`Clicked ${params.target}. Now at ${url} (route ${route}).`, {
						selector,
						url,
						route,
					});
				},
			});

			pi.registerTool({
				name: BROWSER_TOOLS.fill,
				label: "Fill",
				description:
					"Type into an input. For credentials pass `secret_env` (the name of an environment variable) instead of `value`; the secret never enters the transcript.",
				promptSnippet: "Type a value into an input field",
				parameters: Type.Object({
					target: Type.String({ description: TARGET_DESCRIPTION }),
					value: Type.Optional(Type.String({ description: "Literal text to type." })),
					secret_env: Type.Optional(
						Type.String({
							description:
								"Environment variable holding the value, e.g. GRIBBLE_USER_PASSWORD. Use for secrets.",
						}),
					),
				}),
				async execute(_id, params) {
					let value: string;
					let step: { value: string; secret?: boolean };
					if (params.secret_env) {
						const fromEnv = state.env[params.secret_env];
						if (!fromEnv) throw new Error(`Environment variable ${params.secret_env} is not set.`);
						value = fromEnv;
						step = { value: `\${${params.secret_env}}`, secret: true };
					} else if (params.value !== undefined) {
						value = params.value;
						step = { value: params.value };
					} else {
						throw new Error("fill needs either `value` or `secret_env`.");
					}
					const page = await state.currentPage();
					const { selector, problem } = await selectorForReplay(state, params.target);
					await page.fill(params.target, value);
					state.recordStep({ action: "fill", selector, ...step }, problem);
					return textResult(
						params.secret_env
							? `Filled ${params.target} from ${params.secret_env}.`
							: `Filled ${params.target}.`,
						{ selector, secret: !!params.secret_env },
					);
				},
			});

			pi.registerTool({
				name: BROWSER_TOOLS.press,
				label: "Press key",
				description: "Press a keyboard key on the focused element, e.g. Enter, Tab, Escape, ArrowDown.",
				promptSnippet: "Press a keyboard key",
				parameters: Type.Object({ key: Type.String({ description: "Key name, e.g. Enter." }) }),
				async execute(_id, params) {
					const page = await state.currentPage();
					await page.press(params.key);
					state.recordStep({ action: "press", key: params.key });
					const url = page.url();
					state.trackUrl(url);
					return textResult(`Pressed ${params.key}. Now at ${url}.`, { url });
				},
			});

			pi.registerTool({
				name: BROWSER_TOOLS.waitFor,
				label: "Wait for",
				description:
					"Wait until a selector is visible, the URL matches a glob or regex, or a text appears. Use after actions that load data.",
				promptSnippet: "Wait for an element, URL or text",
				parameters: Type.Object({
					selector: Type.Optional(Type.String({ description: "Selector that must become visible." })),
					url: Type.Optional(Type.String({ description: "URL glob (`/dashboard*`) or `/regex/`." })),
					text: Type.Optional(Type.String({ description: "Text that must become visible." })),
					timeoutMs: Type.Optional(Type.Integer({ description: "Timeout, default 10000.", minimum: 100 })),
				}),
				async execute(_id, params) {
					if (!params.selector && !params.url && !params.text) {
						throw new Error("wait_for needs one of selector, url or text.");
					}
					const page = await state.currentPage();
					await page.waitFor({
						selector: params.selector,
						url: params.url,
						text: params.text,
						timeoutMs: params.timeoutMs ?? 10000,
					});
					state.recordStep({
						action: "wait_for",
						selector: params.selector,
						url: params.url,
						text: params.text,
						timeoutMs: params.timeoutMs,
					});
					const url = page.url();
					state.trackUrl(url);
					return textResult(`Condition met. Now at ${url}.`, { url });
				},
			});

			pi.registerTool({
				name: BROWSER_TOOLS.pageSnapshot,
				label: "Page snapshot",
				description:
					"Structured view of the current page: accessibility tree, interactive elements with refs (`e12`), layout problems and style values outside the design tokens computed by code, console errors and failed requests. Your primary sense; read it before judging a page.",
				promptSnippet: "Read the structured snapshot of the current page",
				parameters: Type.Object({
					includeDom: Type.Optional(
						Type.Boolean({ description: "Also include the simplified DOM (long). Default false." }),
					),
					maxChars: Type.Optional(
						Type.Integer({ description: "Cap for the returned text. Default 40000.", minimum: 1000 }),
					),
				}),
				async execute(_id, params, _signal, onUpdate) {
					const page = await state.currentPage();
					onUpdate?.({ content: [{ type: "text", text: "Reading the page…" }], details: {} });
					const tokens = await snapshotTokensFor(state);
					const snapshot = await page.snapshot({
						includeDom: params.includeDom,
						maxChars: params.maxChars,
						tokens,
						minFontPx: minFontPx(state),
					});
					state.lastSnapshot = snapshot;
					state.lastSnapshotViewport = page.viewport;
					state.trackUrl(snapshot.url);
					const text = formatSnapshot(snapshot, { includeDom: params.includeDom, maxChars: params.maxChars });
					return textResult(text, snapshot);
				},
			});

			pi.registerTool({
				name: BROWSER_TOOLS.extractText,
				label: "Extract text",
				description:
					"Visible text of the page or of one element. Cheaper than a snapshot when you only need copy.",
				promptSnippet: "Read the visible text of the page or an element",
				parameters: Type.Object({
					selector: Type.Optional(
						Type.String({ description: "Limit to this selector; default whole page." }),
					),
					maxChars: Type.Optional(Type.Integer({ description: "Cap, default 20000.", minimum: 100 })),
				}),
				async execute(_id, params) {
					const page = await state.currentPage();
					const text = await page.text(params.selector);
					const max = params.maxChars ?? 20000;
					const clipped =
						text.length > max ? `${text.slice(0, max)}\n[truncated at ${max} characters]` : text;
					return textResult(clipped || "(no visible text)", { length: text.length });
				},
			});

			pi.registerTool({
				name: BROWSER_TOOLS.listConsoleErrors,
				label: "Console errors",
				description:
					"Console errors/warnings and failed network requests collected since the last navigation.",
				promptSnippet: "List console errors and failed requests since the last navigation",
				parameters: Type.Object({}),
				async execute() {
					const page = await state.currentPage();
					const console = page.drainConsole();
					const failed = page.drainFailedRequests();
					const lines: string[] = [];
					for (const c of console) lines.push(`- [${c.level}] ${c.text}${c.url ? ` (${c.url})` : ""}`);
					for (const f of failed)
						lines.push(`- ${f.method} ${f.url} -> ${f.status ?? f.failure ?? "failed"}`);
					return textResult(lines.length ? lines.join("\n") : "No console errors or failed requests.", {
						console,
						failedRequests: failed,
					});
				},
			});

			if (state.viewportNames.length > 1 || state.pages.size > 0) {
				pi.registerTool({
					name: BROWSER_TOOLS.setViewport,
					label: "Set viewport",
					description: `Switch the active viewport. Configured: ${state.viewportNames.join(", ")}. Each viewport keeps its own page; the new page opens at the current URL.`,
					promptSnippet: "Switch between the configured viewports",
					parameters: Type.Object({
						viewport: Type.String({ description: `One of: ${state.viewportNames.join(", ")}.` }),
					}),
					async execute(_id, params) {
						if (!state.config.viewports[params.viewport] && !state.pages.has(params.viewport)) {
							throw new Error(
								`Unknown viewport "${params.viewport}". Configured: ${state.viewportNames.join(", ")}`,
							);
						}
						const previous = state.pages.get(state.currentViewport);
						const currentUrl = previous?.url();
						state.currentViewport = params.viewport;
						const page = await state.currentPage();
						if (currentUrl && currentUrl !== "about:blank" && page.url() !== currentUrl) {
							await page.goto(currentUrl);
						}
						const size = page.viewportSize;
						return textResult(
							`Viewport is now ${params.viewport} (${size.width}x${size.height}) at ${page.url()}.`,
							{
								viewport: params.viewport,
								url: page.url(),
							},
						);
					},
				});
			}

			if (state.vision) {
				pi.registerTool({
					name: BROWSER_TOOLS.screenshot,
					label: "Screenshot",
					description:
						"PNG screenshot of the current viewport. Use only when the snapshot cannot tell you what you need (canvas, images, visual polish). Saved to the run directory.",
					promptSnippet: "Take a screenshot when the snapshot is not enough",
					parameters: Type.Object({
						fullPage: Type.Optional(Type.Boolean({ description: "Capture the whole page. Default false." })),
					}),
					async execute(_id, params) {
						const page = await state.currentPage();
						const png = await page.screenshot({ fullPage: params.fullPage });
						const dir = join(state.runDir, "screenshots");
						await mkdir(dir, { recursive: true });
						const file = join(
							dir,
							`agent-${String(state.screenshots.length + 1).padStart(3, "0")}@${page.viewport}.png`,
						);
						await writeFile(file, png);
						state.screenshots.push(file);
						return {
							content: [
								{ type: "image", data: png.toString("base64"), mimeType: "image/png" },
								{ type: "text", text: `Screenshot of ${page.url()} saved to ${file}` },
							],
							details: { path: file, url: page.url(), viewport: page.viewport },
						};
					},
				});
			}
		},
	};
}
