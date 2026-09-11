import { defineConfig } from "tsdown";

// The `skills/` folder is shipped verbatim via package.json `files`; nothing is copied
// into dist/, and `skillSource()` resolves it relative to the built module.
export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	dts: true,
	platform: "node",
	clean: true,
	fixedExtension: false,
});
