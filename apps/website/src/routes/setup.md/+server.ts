import { error } from "@sveltejs/kit";
import { getDoc } from "$lib/server/docs";
import { site } from "$lib/site";
import type { RequestHandler } from "./$types";

export const prerender = true;

/**
 * The agent setup guide as plain Markdown: the URL the home page tells people to hand their
 * coding agent. The page's human-facing intro (everything before the first `##`) is swapped for
 * one line addressed to the agent, and links into the docs point at the raw `.md` form.
 */
export const GET: RequestHandler = () => {
	const doc = getDoc("agent-setup");
	if (!doc) error(404, "The agent setup guide has not been published.");

	const firstSection = doc.body.search(/^## /m);
	const steps = firstSection === -1 ? doc.body : doc.body.slice(firstSection);
	const body = steps.replace(
		/\]\(\/docs\/([^)#\s]+)(#[^)\s]*)?\)/g,
		(_match, slug: string, hash = "") => `](${site.url}/docs/${slug}.md${hash})`,
	);

	const intro = `You were asked to add Gribble to this project. Follow these steps in order. The same guide is readable in the browser at ${site.url}/docs/agent-setup.`;

	return new Response(`# ${doc.title}\n\n${intro}\n\n${body}`, {
		headers: {
			"content-type": "text/markdown; charset=utf-8",
			"cache-control": "public, max-age=3600",
		},
	});
};
