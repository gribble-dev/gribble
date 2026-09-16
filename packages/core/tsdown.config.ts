import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";
import { parse } from "yaml";

/**
 * The pi packages are optional peer dependencies (see `src/pi.ts`), and the pnpm catalog is the
 * one place their exact version is pinned. Injecting it here keeps the peer ranges and the
 * "install the review runtime" message quoting the same version, with no second hard-coded pin.
 */
function piCatalogVersion(): string {
	const path = fileURLToPath(new URL("../../pnpm-workspace.yaml", import.meta.url));
	const workspace = parse(readFileSync(path, "utf8")) as {
		catalog?: Record<string, string>;
	};
	const version = workspace.catalog?.["@earendil-works/pi-ai"];
	if (!version) throw new Error("pnpm-workspace.yaml has no catalog entry for @earendil-works/pi-ai");
	return version;
}

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	dts: true,
	platform: "node",
	clean: true,
	fixedExtension: false,
	define: { __GRIBBLE_PI_VERSION__: JSON.stringify(piCatalogVersion()) },
});
