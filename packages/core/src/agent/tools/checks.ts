/**
 * Packs that wrap the deterministic checkers for the current page: crawl (links, page
 * enumeration), perf (Lighthouse), a11y (axe) and seo (meta, sitemap, robots). All of them stay
 * inactive until `search_tools` loads them; deterministic checks normally run outside the loop.
 */
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { checkHtml, checkLinks, checkSeo, runAxe, runLighthouse } from "../../checks/index.js";
import { discoverRoutes } from "../../repo/index.js";
import { A11Y_TOOLS, CRAWL_TOOLS, PERF_TOOLS, SEO_TOOLS } from "../names.js";
import type { AgentState } from "../state.js";
import { absorbFindings, checkContextFor, formatFindings, textResult } from "./common.js";

const NO_PARAMS = Type.Object({});

export function crawlPack(state: AgentState): InlineExtension {
	return {
		name: "gribble-crawl",
		factory: (pi: ExtensionAPI) => {
			pi.registerTool({
				name: CRAWL_TOOLS.checkLinks,
				label: "Check links",
				description:
					"Run the deterministic link checker (links/*) on the current page: broken internal links, redirect chains, empty hrefs, target=_blank without noopener.",
				parameters: NO_PARAMS,
				async execute(_id, _params, signal, onUpdate) {
					const page = await state.currentPage();
					onUpdate?.({ content: [{ type: "text", text: "Checking links…" }], details: {} });
					const findings = await checkLinks(checkContextFor(state, page, { signal }));
					const added = absorbFindings(state, findings);
					return textResult(formatFindings(findings, added), { findings });
				},
			});

			pi.registerTool({
				name: CRAWL_TOOLS.enumeratePages,
				label: "Enumerate pages",
				description:
					"List the routes known for this site: framework routes discovered from source, the routes resolved for this run, and same-origin links on the current page.",
				parameters: NO_PARAMS,
				async execute() {
					const discovered = await discoverRoutes(state.project.targetDir).catch(() => undefined);
					const origin = new URL(state.config.target.url).origin;
					const links = new Set<string>();
					for (const el of state.lastSnapshot?.interactive ?? []) {
						if (!el.href) continue;
						try {
							const url = new URL(el.href, state.config.target.url);
							if (url.origin === origin) links.add(url.pathname + url.search);
						} catch {
							// ignore unparsable hrefs
						}
					}
					const lines: string[] = [];
					if (discovered?.framework) lines.push(`framework: ${discovered.framework}`);
					if (discovered?.routes.length) {
						lines.push("", "## Routes from source", "");
						for (const route of discovered.routes) {
							const file = discovered.source[route];
							lines.push(`- ${route}${file ? `  (${file})` : ""}`);
						}
					}
					if (state.routes.length) {
						lines.push("", "## Routes in this run", "");
						for (const route of state.routes)
							lines.push(`- ${route}${state.urls[route] ? ` -> ${state.urls[route]}` : ""}`);
					}
					if (links.size) {
						lines.push("", "## Links on the current page", "");
						for (const link of [...links].sort()) lines.push(`- ${link}`);
					}
					return textResult(
						lines.length ? lines.join("\n").trim() : "No routes known. Start at the target URL.",
						{
							framework: discovered?.framework,
							discovered: discovered?.routes ?? [],
							source: discovered?.source ?? {},
							runRoutes: state.routes,
							links: [...links],
						},
					);
				},
			});
		},
	};
}

export function perfPack(state: AgentState): InlineExtension {
	return {
		name: "gribble-perf",
		factory: (pi: ExtensionAPI) => {
			pi.registerTool({
				name: PERF_TOOLS.runLighthouse,
				label: "Run Lighthouse",
				description:
					"Run Lighthouse on the current page (perf/*): performance score, LCP, CLS, TBT and page weight. Slow (20-60 s); use once per route at most.",
				parameters: NO_PARAMS,
				async execute(_id, _params, signal, onUpdate) {
					const page = await state.currentPage();
					onUpdate?.({ content: [{ type: "text", text: "Lighthouse is warming up…" }], details: {} });
					const { findings, metrics } = await runLighthouse(checkContextFor(state, page, { signal }));
					const added = absorbFindings(state, findings);
					const metricLine = Object.entries(metrics)
						.map(([k, v]) => `${k}=${v}`)
						.join("  ");
					return textResult(`${metricLine || "No metrics."}\n${formatFindings(findings, added)}`, {
						findings,
						metrics,
					});
				},
			});
		},
	};
}

export function a11yPack(state: AgentState): InlineExtension {
	return {
		name: "gribble-a11y",
		factory: (pi: ExtensionAPI) => {
			pi.registerTool({
				name: A11Y_TOOLS.runAxe,
				label: "Run axe",
				description:
					"Run axe-core on the current page (a11y/*): missing alt text, unlabeled form fields, contrast, accessible names.",
				parameters: NO_PARAMS,
				async execute(_id, _params, signal, onUpdate) {
					const page = await state.currentPage();
					onUpdate?.({ content: [{ type: "text", text: "Running axe…" }], details: {} });
					const findings = await runAxe(checkContextFor(state, page, { signal }));
					const added = absorbFindings(state, findings);
					return textResult(formatFindings(findings, added), { findings });
				},
			});
		},
	};
}

async function fetchText(
	url: string,
	signal?: AbortSignal,
): Promise<{ status: number; text: string; contentType?: string }> {
	const response = await fetch(url, { signal, redirect: "follow" });
	const text = await response.text();
	return { status: response.status, text, contentType: response.headers.get("content-type") ?? undefined };
}

export function seoPack(state: AgentState): InlineExtension {
	return {
		name: "gribble-seo",
		factory: (pi: ExtensionAPI) => {
			pi.registerTool({
				name: SEO_TOOLS.checkMeta,
				label: "Check meta",
				description:
					"Run the SEO and HTML checkers on the current page (seo/*, html/*): title, description, h1, canonical, robots, lang, Open Graph, doctype, charset, viewport meta, duplicate ids.",
				parameters: NO_PARAMS,
				async execute(_id, _params, signal) {
					const page = await state.currentPage();
					const ctx = checkContextFor(state, page, { signal });
					const findings = [...(await checkSeo(ctx)), ...(await checkHtml(ctx))];
					const added = absorbFindings(state, findings);
					return textResult(formatFindings(findings, added), { findings });
				},
			});

			pi.registerTool({
				name: SEO_TOOLS.checkSitemap,
				label: "Check sitemap",
				description: "Fetch /sitemap.xml and list the URLs it declares (up to 200).",
				parameters: NO_PARAMS,
				async execute(_id, _params, signal) {
					const url = state.resolveUrl("/sitemap.xml");
					const result = await fetchText(url, signal);
					if (result.status >= 400) {
						return textResult(`${url} responded ${result.status}: no sitemap.`, {
							url,
							status: result.status,
							urls: [],
						});
					}
					const urls = [...result.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1] ?? "");
					const head = urls.slice(0, 200).map((u) => `- ${u}`);
					return textResult(
						`${url} (status ${result.status}) lists ${urls.length} URL(s).${head.length ? `\n${head.join("\n")}` : ""}`,
						{ url, status: result.status, urls },
					);
				},
			});

			pi.registerTool({
				name: SEO_TOOLS.checkRobots,
				label: "Check robots.txt",
				description: "Fetch /robots.txt and return its directives.",
				parameters: NO_PARAMS,
				async execute(_id, _params, signal) {
					const url = state.resolveUrl("/robots.txt");
					const result = await fetchText(url, signal);
					if (result.status >= 400) {
						return textResult(`${url} responded ${result.status}: no robots.txt.`, {
							url,
							status: result.status,
							text: "",
						});
					}
					const text = result.text.trim().slice(0, 4000);
					const disallowsAll = /^\s*Disallow:\s*\/\s*$/im.test(result.text);
					return textResult(
						`${url} (status ${result.status})${disallowsAll ? " — contains a blanket Disallow: /" : ""}\n\n${text || "(empty)"}`,
						{ url, status: result.status, text: result.text, disallowsAll },
					);
				},
			});
		},
	};
}
