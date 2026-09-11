import { allDocs } from "$lib/server/docs";
import { site } from "$lib/site";
import type { RequestHandler } from "./$types";

export const prerender = true;

/** Every documentation page concatenated, for models that want the whole corpus at once. */
export const GET: RequestHandler = () => {
	const docs = allDocs();
	const parts: string[] = [];

	parts.push(`# ${site.name}`);
	parts.push("");
	parts.push(`> ${site.tagline} ${site.description}`);
	parts.push("");
	parts.push(`Source: ${site.url}/llms-full.txt`);
	parts.push("");

	if (docs.length === 0) {
		parts.push("The documentation has not been published yet.");
		parts.push("");
	}

	for (const doc of docs) {
		const slug = doc.slug === "" ? "index" : doc.slug;
		parts.push("---");
		parts.push("");
		parts.push(`# ${doc.title}`);
		parts.push("");
		if (doc.description) {
			parts.push(doc.description);
			parts.push("");
		}
		parts.push(`Source: ${site.url}/docs/${slug}.md`);
		parts.push("");
		parts.push(doc.body.trim());
		parts.push("");
	}

	return new Response(parts.join("\n"), {
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "public, max-age=3600",
		},
	});
};
