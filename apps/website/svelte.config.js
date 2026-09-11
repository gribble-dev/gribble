import adapter from "@sveltejs/adapter-cloudflare";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { mdsvex } from "mdsvex";

/** @type {import("@sveltejs/kit").Config} */
const config = {
	// `.svx` files are Svelte components written in Markdown. The documentation pages under the
	// repo-root `docs/` folder are compiled by `src/lib/docs.ts` instead.
	extensions: [".svelte", ".svx"],
	preprocess: [vitePreprocess(), mdsvex({ extensions: [".svx"] })],
	kit: {
		// One Worker with static assets in front of it: prerendered pages are served straight
		// from the asset store, everything else (e.g. /rules/<id>) falls through to the Worker.
		adapter: adapter(),
		prerender: {
			// Warn instead of fail: `docs/` is authored separately and a link to a page that has
			// not landed yet should not break the site build.
			handleHttpError: "fail",
			handleMissingId: "fail",
		},
	},
};

export default config;
