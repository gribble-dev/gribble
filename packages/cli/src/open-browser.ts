import { spawn } from "node:child_process";

export type OpenBrowser = (url: string) => void;

/**
 * Open a URL in the platform's default browser, best effort: the caller still prints the URL,
 * so a missing launcher (no `xdg-open` on a headless box) is silently ignored.
 *
 * Mirrors pi's internal `openBrowser`, which is not exported. Never goes through a shell: on
 * Windows `cmd /c start` would re-parse `&` and friends in the URL before `start` sees it.
 */
export const openBrowser: OpenBrowser = (url) => {
	const [cmd, args]: [string, string[]] =
		process.platform === "darwin"
			? ["open", [url]]
			: process.platform === "win32"
				? ["rundll32", ["url.dll,FileProtocolHandler", url]]
				: ["xdg-open", [url]];
	spawn(cmd, args, { stdio: "ignore", detached: true })
		.on("error", () => {})
		.unref();
};
