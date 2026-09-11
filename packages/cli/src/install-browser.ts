import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { RunContext } from "./ui.js";

export type InstallBrowser = (opts: { withDeps: boolean; context: RunContext }) => Promise<number>;

/** Absolute path of Playwright's CLI entry, or undefined when the package cannot be found. */
export function resolvePlaywrightCli(): string | undefined {
	try {
		const url = import.meta.resolve("playwright/cli.js");
		return url.startsWith("file:") ? fileURLToPath(url) : url;
	} catch {
		// fall through to require.resolve
	}
	try {
		return createRequire(import.meta.url).resolve("playwright/cli.js");
	} catch {
		return undefined;
	}
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
