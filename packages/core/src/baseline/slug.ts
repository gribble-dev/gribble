/**
 * File-name slug for a route: `/` -> `index`, `/blog/[slug]` -> `blog__slug_`.
 * Surrounding slashes are trimmed, then every remaining non-alphanumeric character becomes `_`.
 */
export function routeSlug(route: string): string {
	const trimmed = route.trim().replace(/^\/+|\/+$/g, "");
	if (trimmed === "") return "index";
	return trimmed.replace(/[^A-Za-z0-9]/g, "_");
}
