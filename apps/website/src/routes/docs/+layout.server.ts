import { docGroups } from "$lib/server/docs";
import type { LayoutServerLoad } from "./$types";

export const prerender = true;

export const load: LayoutServerLoad = () => {
	return {
		nav: docGroups().map((group) => ({
			id: group.id,
			label: group.label,
			pages: group.pages.map((page) => ({
				slug: page.slug,
				href: page.slug === "" ? "/docs" : `/docs/${page.slug}`,
				title: page.title,
			})),
		})),
	};
};
