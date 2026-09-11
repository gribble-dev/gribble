import { docGroups, getDoc, renderDoc } from "$lib/server/docs";
import { site } from "$lib/site";
import type { PageServerLoad } from "./$types";

export const prerender = true;

export const load: PageServerLoad = () => {
	const index = getDoc("");
	const rendered = index ? renderDoc(index) : undefined;
	// `docs/index.md` is titled after the product; on the site the page is the docs landing page.
	const title = !index || index.title === site.name ? "Documentation" : index.title;

	return {
		title,
		description: index?.description ?? "Guides, configuration reference and rule documentation for Gribble.",
		html: rendered?.html ?? "",
		hasIndex: Boolean(index),
		sections: docGroups()
			.map((group) => ({
				id: group.id,
				label: group.label,
				pages: group.pages
					.filter((page) => page.slug !== "")
					.map((page) => ({
						href: `/docs/${page.slug}`,
						title: page.title,
						description: page.description,
					})),
			}))
			.filter((group) => group.pages.length > 0),
	};
};
