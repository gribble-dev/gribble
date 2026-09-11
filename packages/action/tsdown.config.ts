import { defineConfig } from "tsdown";

/**
 * GitHub runs `dist/index.js` with no node_modules, so every dependency
 * (`@actions/*`, `@gribble/core`, `yaml`) is inlined into one ESM file.
 * ESM works on the node20 runner because this package has `"type": "module"`.
 */
export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	platform: "node",
	target: "node20",
	dts: false,
	minify: false,
	clean: true,
	fixedExtension: false,
	sourcemap: false,
	shims: true,
	deps: {
		alwaysBundle: [/.*/],
		onlyBundle: false,
	},
	outputOptions: {
		// Keep the dynamic `import("@gribble/core")` in the same file: one dist/index.js.
		codeSplitting: false,
	},
});
