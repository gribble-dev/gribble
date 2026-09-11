import { error } from "@sveltejs/kit";
import { docEntries, getDoc, renderDoc } from "$lib/server/docs";
import type { EntryGenerator, PageServerLoad } from "./$types";

export const prerender = true;

export const entries: EntryGenerator = () => docEntries();

export const load: PageServerLoad = ({ params }) => {
	const slug = params.slug.replace(/\/$/, "");
	const doc = getDoc(slug);
	if (!doc) error(404, `No documentation page at /docs/${slug}`);

	const { html, headings } = renderDoc(doc);
	return {
		slug: doc.slug,
		title: doc.title,
		description: doc.description,
		sourcePath: doc.sourcePath,
		html,
		headings,
	};
};
