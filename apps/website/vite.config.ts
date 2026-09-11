import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		fs: {
			// The documentation source lives at the repo root, outside this app.
			allow: ["../.."],
		},
	},
	preview: {
		port: 4173,
	},
});
