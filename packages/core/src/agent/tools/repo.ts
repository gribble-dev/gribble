/**
 * Repo pack: what the source tree knows. Route discovery, design tokens and DOM-to-source mapping.
 */
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type DiscoveredRoutes, discoverRoutes, mapDomToSource, readDesignTokens } from "../../repo/index.js";
import { REPO_TOOLS } from "../names.js";
import type { AgentState } from "../state.js";
import { textResult } from "./common.js";

const routesCache = new WeakMap<AgentState, Promise<DiscoveredRoutes>>();

/** Discovered routes for the target, cached per session. */
export function discoveredRoutesFor(state: AgentState): Promise<DiscoveredRoutes> {
	let promise = routesCache.get(state);
	if (!promise) {
		promise = discoverRoutes(state.project.targetDir);
		routesCache.set(state, promise);
	}
	return promise;
}

export const MAP_DOM_TO_SOURCE_PARAMS = Type.Object({
	testId: Type.Optional(Type.String({ description: "data-testid of the element." })),
	id: Type.Optional(Type.String({ description: "DOM id of the element." })),
	text: Type.Optional(
		Type.String({ description: "Unique visible text of the element, e.g. a button label." }),
	),
	className: Type.Optional(Type.String({ description: "A distinctive class name." })),
	route: Type.Optional(
		Type.String({ description: "Route the element lives on; default the current route." }),
	),
});

export function repoPack(state: AgentState): InlineExtension {
	return {
		name: "gribble-repo",
		factory: (pi: ExtensionAPI) => {
			pi.registerTool({
				name: REPO_TOOLS.listRoutes,
				label: "List routes",
				description:
					"Routes of the app read from its framework route files (Next.js, SvelteKit, Nuxt, Astro, Remix, React Router), with the source file for each.",
				promptSnippet: "List the app's routes and their source files",
				parameters: Type.Object({}),
				async execute() {
					const discovered = await discoveredRoutesFor(state);
					if (discovered.routes.length === 0) {
						return textResult(
							"No framework routes found in the source tree. Use the routes listed in the prompt.",
							discovered,
						);
					}
					const lines = discovered.routes.map(
						(r) => `- ${r}${discovered.source[r] ? `  (${discovered.source[r]})` : ""}`,
					);
					return textResult(
						`framework: ${discovered.framework ?? "unknown"}\n${lines.join("\n")}`,
						discovered,
					);
				},
			});

			pi.registerTool({
				name: REPO_TOOLS.readDesignTokens,
				label: "Read design tokens",
				description:
					"Colors, font sizes and spacing values declared in the project's design tokens (tailwind config, @theme blocks, CSS custom properties).",
				parameters: Type.Object({}),
				async execute() {
					const tokens = await readDesignTokens(state.project.targetDir);
					const list = (values: Set<string>) =>
						values.size ? [...values].slice(0, 200).join(", ") : "(none)";
					const text = [
						`sources: ${tokens.sources.length ? tokens.sources.join(", ") : "(none)"}`,
						`colors (${tokens.colors.size}): ${list(tokens.colors)}`,
						`font sizes (${tokens.fontSizes.size}): ${list(tokens.fontSizes)}`,
						`spacing (${tokens.spacing.size}): ${list(tokens.spacing)}`,
					].join("\n");
					return textResult(text, {
						sources: tokens.sources,
						colors: [...tokens.colors],
						fontSizes: [...tokens.fontSizes],
						spacing: [...tokens.spacing],
					});
				},
			});

			pi.registerTool({
				name: REPO_TOOLS.mapDomToSource,
				label: "Map DOM to source",
				description:
					"Find the source file and component that renders an element, from its data-testid, id, visible text or class name. Use the result as `location` in add_finding.",
				promptSnippet: "Find the source file and component behind a DOM element",
				parameters: MAP_DOM_TO_SOURCE_PARAMS,
				async execute(_id, params) {
					if (!params.testId && !params.id && !params.text && !params.className) {
						throw new Error("map_dom_to_source needs at least one of testId, id, text or className.");
					}
					const discovered = await discoveredRoutesFor(state).catch(() => undefined);
					const matches = await mapDomToSource({
						targetDir: state.project.targetDir,
						testId: params.testId,
						id: params.id,
						text: params.text,
						className: params.className,
						route: params.route ?? state.currentRoute,
						routeSource: discovered?.source,
					});
					if (matches.length === 0) {
						return textResult("No source match. Use a stable selector as the location instead.", {
							matches: [],
						});
					}
					const lines = matches
						.slice(0, 5)
						.map(
							(m) =>
								`- ${m.file}${m.symbol ? `#${m.symbol}` : ""}${m.line ? `:${m.line}` : ""} (score ${m.score.toFixed(2)}, ${m.reason})`,
						);
					return textResult(lines.join("\n"), { matches });
				},
			});
		},
	};
}
