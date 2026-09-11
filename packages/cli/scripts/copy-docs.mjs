#!/usr/bin/env node
// Copies the repository `docs/` tree into `packages/cli/docs/` so the published npm package
// carries the documentation. Runs on `prepack`; the copy is gitignored.
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const source = resolve(packageRoot, "..", "..", "docs");
const target = join(packageRoot, "docs");

try {
	await stat(source);
} catch {
	console.error(`copy-docs: no docs directory at ${source}; nothing copied.`);
	process.exit(0);
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, {
	recursive: true,
	filter: (path) => !path.split(/[\\/]/).includes("README.md"),
});
console.log(`copy-docs: copied ${source} -> ${target}`);
