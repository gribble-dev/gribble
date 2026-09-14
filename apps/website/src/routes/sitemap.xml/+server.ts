import { allDocs } from "$lib/server/docs";
import { site } from "$lib/site";
import type { RequestHandler } from "./$types";

export const prerender = true;

/** Every prerendered page of the site, for crawlers and for Gribble's own seo/sitemap check. */
export const GET: RequestHandler = () => {
	const urls = new Set<string>([`${site.url}/`, `${site.url}/docs`]);
	for (const page of allDocs()) {
		if (page.slug === "") continue;
		urls.add(`${site.url}/docs/${page.slug}`);
	}
	const body = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...[...urls].map((loc) => `  <url><loc>${loc}</loc></url>`),
		"</urlset>",
		"",
	].join("\n");
	return new Response(body, {
		headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
	});
};
