import { docGroups } from "$lib/server/docs";
import { site } from "$lib/site";
import type { RequestHandler } from "./$types";

export const prerender = true;

/** https://llmstxt.org — a map of the documentation for language models. */
export const GET: RequestHandler = () => {
	const lines: string[] = [];
	lines.push(`# ${site.name}`);
	lines.push("");
	lines.push(`> ${site.tagline} ${site.description}`);
	lines.push("");
	lines.push(
		"Gribble is a CLI and GitHub Action. It boots the site under development, walks its routes and flows, and reports findings that point back at source files.",
	);
	lines.push("");
	lines.push(
		`To add Gribble to a project, follow the agent setup guide: ${site.url}/setup.md. It installs the CLI, runs \`gribble init\` non-interactively and stops to ask the user which model to use.`,
	);
	lines.push("");

	const groups = docGroups();
	if (groups.length === 0) {
		lines.push("## Docs");
		lines.push("");
		lines.push("The documentation has not been published yet.");
	}

	for (const group of groups) {
		lines.push(`## ${group.id === "" ? "Docs" : group.label}`);
		lines.push("");
		for (const page of group.pages) {
			const slug = page.slug === "" ? "index" : page.slug;
			const description = page.description ? `: ${page.description}` : "";
			lines.push(`- [${page.title}](${site.url}/docs/${slug}.md)${description}`);
		}
		lines.push("");
	}

	lines.push("## Optional");
	lines.push("");
	lines.push(`- [Full documentation, concatenated](${site.url}/llms-full.txt): every page in one file.`);
	lines.push(`- [gribble.yaml JSON Schema](${site.url}/schema/gribble.json): project configuration.`);
	lines.push(`- [rules.yaml JSON Schema](${site.url}/schema/rules.json): rule severities and options.`);
	lines.push(`- [report.json JSON Schema](${site.url}/schema/report.json): the audit report format.`);
	lines.push(`- [Source repository](${site.github}): issues, releases and the rule registry.`);
	lines.push("");

	return new Response(lines.join("\n"), {
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "public, max-age=3600",
		},
	});
};
