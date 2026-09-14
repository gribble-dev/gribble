import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunContext } from "./ui.js";

export type InstallBrowser = (opts: { withDeps: boolean; context: RunContext }) => Promise<number>;

/**
 * Absolute path of Playwright's CLI entry, or undefined when the package cannot be found.
 *
 * `playwright/cli.js` is not in Playwright's `exports` map, so it cannot be resolved as a
 * specifier (ERR_PACKAGE_PATH_NOT_EXPORTED). `playwright/package.json` is exported; the CLI
 * sits next to it.
 */
export function resolvePlaywrightCli(
	resolve: (specifier: string) => string = (specifier) => createRequire(import.meta.url).resolve(specifier),
	exists: (file: string) => boolean = existsSync,
): string | undefined {
	let pkgPath: string;
	try {
		pkgPath = resolve("playwright/package.json");
	} catch {
		return undefined;
	}
	if (pkgPath.startsWith("file:")) pkgPath = fileURLToPath(pkgPath);
	const cli = path.join(path.dirname(pkgPath), "cli.js");
	return exists(cli) ? cli : undefined;
}

/** Runs `playwright install chromium [--with-deps]` with inherited stdio; resolves to the exit code. */
export const installBrowser: InstallBrowser = ({ withDeps, context }) => {
	const cli = resolvePlaywrightCli();
	if (!cli) return Promise.resolve(-1);
	const args = [cli, "install"];
	if (withDeps) args.push("--with-deps");
	args.push("chromium");
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, args, {
			cwd: context.cwd,
			env: context.env,
			stdio: ["inherit", "inherit", "inherit"],
		});
		child.on("error", reject);
		child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
	});
};
