/**
 * Starts `target.start` in its own process group and waits until `target.url` answers.
 * Nothing is started when the URL already responds.
 */
import { type ChildProcess, spawn } from "node:child_process";

export interface StartDevServerOptions {
	command: string;
	cwd: string;
	url: string;
	timeoutMs: number;
	env?: NodeJS.ProcessEnv;
	onLog?: (line: string, stream: "stdout" | "stderr") => void;
	signal?: AbortSignal;
}

export interface DevServer {
	/** True when Gribble started the process (false when the URL was already up). */
	started: boolean;
	pid?: number;
	stop(): Promise<void>;
}

const POLL_MS = 500;

/** True when the URL answers with a 2xx or 3xx status. */
export async function urlResponds(url: string, timeoutMs = 3_000): Promise<boolean> {
	try {
		const res = await fetch(url, {
			method: "GET",
			redirect: "manual",
			signal: AbortSignal.timeout(timeoutMs),
		});
		await res.body?.cancel().catch(() => {});
		return res.status < 400;
	} catch {
		return false;
	}
}

function sleep(ms: number): Promise<void> {
	// Deliberately not unref'd: while polling, this timer may be the only live handle (the dev
	// server may already have died), and an unref'd timer lets Node exit mid-await with code 13.
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function killTree(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
	const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
	try {
		if (process.platform === "win32") {
			spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
		} else {
			process.kill(-child.pid, "SIGTERM");
		}
	} catch {
		child.kill("SIGTERM");
	}
	const timeout = sleep(5_000).then(() => {
		try {
			if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
			else child.kill("SIGKILL");
		} catch {
			// already gone
		}
	});
	await Promise.race([exited, timeout]);
}

/** Start the dev server unless the URL already responds; resolves once the URL answers. */
/** The configured `target.start` command could not bring the site up; a setup problem, not a crash. */
export class DevServerError extends Error {
	override readonly name = "DevServerError";
}

export async function startDevServer(opts: StartDevServerOptions): Promise<DevServer> {
	if (await urlResponds(opts.url)) {
		return { started: false, stop: async () => {} };
	}
	const child = spawn(opts.command, {
		cwd: opts.cwd,
		env: { ...process.env, ...(opts.env ?? {}), FORCE_COLOR: "0", CI: opts.env?.CI ?? process.env.CI ?? "1" },
		shell: true,
		detached: process.platform !== "win32",
		stdio: ["ignore", "pipe", "pipe"],
	});
	const forward = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
		for (const line of chunk.toString("utf8").split(/\r?\n/)) if (line.trim()) opts.onLog?.(line, stream);
	};
	child.stdout?.on("data", forward("stdout"));
	child.stderr?.on("data", forward("stderr"));
	let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
	child.once("exit", (code, signal) => {
		exited = { code, signal };
	});
	child.once("error", (err) => {
		opts.onLog?.(`failed to start: ${err.message}`, "stderr");
	});

	const server: DevServer = {
		started: true,
		pid: child.pid,
		stop: async () => {
			await killTree(child);
		},
	};

	const deadline = Date.now() + opts.timeoutMs;
	while (Date.now() < deadline) {
		if (opts.signal?.aborted) {
			await server.stop();
			throw new Error("aborted while waiting for the dev server");
		}
		if (exited) {
			throw new DevServerError(
				`dev server command exited ${exited.code !== null ? `with code ${exited.code}` : `on ${exited.signal}`} before ${opts.url} responded: ${opts.command}`,
			);
		}
		if (await urlResponds(opts.url)) return server;
		await sleep(POLL_MS);
	}
	await server.stop();
	throw new DevServerError(
		`dev server did not respond at ${opts.url} within ${Math.round(opts.timeoutMs / 1000)}s: ${opts.command}`,
	);
}
