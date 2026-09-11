import { defineConfig } from "tsdown";

/**
 * Two entries: the programmatic API (`run(argv)`) with type declarations, and the `gribble` bin.
 * `src/bin.ts` carries a shebang that tsdown preserves. Workspace packages and Playwright stay
 * external (they are dependencies); the small prompt/color/argument libraries are bundled.
 */
export default defineConfig({
	entry: { index: "src/index.ts", bin: "src/bin.ts" },
	format: ["esm"],
	platform: "node",
	target: "node22",
	clean: true,
	fixedExtension: false,
	dts: { entry: "src/index.ts" },
	shims: true,
	deps: {
		neverBundle: [
			"@gribble/core",
			"@gribble/skills",
			"playwright",
			"@earendil-works/pi-coding-agent",
			"@earendil-works/pi-ai",
		],
	},
});
