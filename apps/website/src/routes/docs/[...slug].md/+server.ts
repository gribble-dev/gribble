import { error } from "@sveltejs/kit";
import { allDocs, getDoc } from "$lib/server/docs";
import type { EntryGenerator, RequestHandler } from "./$types";

export const prerender = true;

// `/docs/index.md` is the raw form of the documentation landing page (slug `""`).
export const entries: EntryGenerator = () =>
	allDocs().map((doc) => ({ slug: doc.slug === "" ? "index" : doc.slug }));

export const GET: RequestHandler = ({ params }) => {
	const slug = params.slug === "index" ? "" : params.slug;
	const doc = getDoc(slug);
	if (!doc) error(404, `No documentation page at /docs/${params.slug}.md`);

	return new Response(doc.raw, {
		headers: {
			"content-type": "text/markdown; charset=utf-8",
			"cache-control": "public, max-age=3600",
		},
	});
};
