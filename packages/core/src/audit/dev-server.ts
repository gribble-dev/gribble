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

export interface DevServerExit {
	code: number | null;
	signal: NodeJS.Signals | null;
}

export interface DevServer {
	/** True when Gribble started the process (false when the URL was already up). */
	started: boolean;
	pid?: number;
	/**
	 * Settles when the started process exits without `stop()` having been called. Stays pending
	 * otherwise, and when nothing was started.
	 */
	unexpectedExit: Promise<DevServerExit>;
	/** The last lines the process printed, oldest first, prefixed with their stream. */
	outputTail(): string[];
	stop(): Promise<void>;
}

const POLL_MS = 500;
/** Lines of dev server output kept for the error message when it dies. */
export const OUTPUT_TAIL_LINES = 40;
const KILL_GRACE_MS = 5_000;

/** The configured `target.start` command could not bring the site up; a setup problem, not a crash. */
export class DevServerError extends Error {
	override readonly name = "DevServerError";
	/** The last lines the command printed before it gave up. */
	readonly output: string[];

	constructor(message: string, output: string[] = []) {
		super(message);
		this.output = output;
	}
}

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

/** `with code 1` or `on SIGSEGV`. */
export function describeExit(exit: DevServerExit): string {
	return exit.code !== null ? `with code ${exit.code}` : `on ${exit.signal ?? "an unknown signal"}`;
}

function groupAlive(pgid: number): boolean {
	try {
		process.kill(-pgid, 0);
		return true;
	} catch {
		// ESRCH: the group is empty. EPERM: the id belongs to someone else now. Either way, done.
		return false;
	}
}

/**
 * Stop the whole process group, not only the shell Gribble spawned. The shell may be gone while
 * the server it launched lives on (`a && b`, package manager wrappers, a crashed runtime whose
 * supervisor keeps running): those orphans still hold our stdout/stderr pipes and keep this
 * process from exiting, so the group is signalled even when the leader already exited.
 */
async function killTree(child: ChildProcess): Promise<void> {
	const pid = child.pid;
	if (!pid) return;
	const leaderRunning = child.exitCode === null && child.signalCode === null;
	if (process.platform === "win32") {
		if (!leaderRunning) return;
		const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
		spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
		await Promise.race([exited, sleep(KILL_GRACE_MS)]);
		return;
	}
	try {
		process.kill(-pid, "SIGTERM");
	} catch {
		// The group is empty; the leader may still need a nudge if it left the group.
		if (leaderRunning) child.kill("SIGTERM");
	}
	const deadline = Date.now() + KILL_GRACE_MS;
	while (Date.now() < deadline && groupAlive(pid)) await sleep(100);
	if (groupAlive(pid)) {
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			// already gone
		}
	}
}

export async function startDevServer(opts: StartDevServerOptions): Promise<DevServer> {
	if (await urlResponds(opts.url)) {
		return {
			started: false,
			unexpectedExit: new Promise(() => {}),
			outputTail: () => [],
			stop: async () => {},
		};
	}
	const child = spawn(opts.command, {
		cwd: opts.cwd,
		env: { ...process.env, ...(opts.env ?? {}), FORCE_COLOR: "0", CI: opts.env?.CI ?? process.env.CI ?? "1" },
		shell: true,
		detached: process.platform !== "win32",
		stdio: ["ignore", "pipe", "pipe"],
	});
	const tail: string[] = [];
	const remember = (line: string, stream: "stdout" | "stderr") => {
		tail.push(`[${stream}] ${line}`);
		if (tail.length > OUTPUT_TAIL_LINES) tail.shift();
		opts.onLog?.(line, stream);
	};
	const forward = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
		for (const line of chunk.toString("utf8").split(/\r?\n/)) if (line.trim()) remember(line, stream);
	};
	child.stdout?.on("data", forward("stdout"));
	child.stderr?.on("data", forward("stderr"));
	let exited: DevServerExit | undefined;
	let stopping = false;
	let reportExit: (exit: DevServerExit) => void = () => {};
	const unexpectedExit = new Promise<DevServerExit>((resolve) => {
		reportExit = resolve;
	});
	child.once("exit", (code, signal) => {
		exited = { code, signal };
		if (!stopping) reportExit(exited);
	});
	child.once("error", (err) => {
		remember(`failed to start: ${err.message}`, "stderr");
	});

	const server: DevServer = {
		started: true,
		pid: child.pid,
		unexpectedExit,
		outputTail: () => [...tail],
		stop: async () => {
			stopping = true;
			await killTree(child);
			// Whatever survived the kill must not pin this process through the pipes.
			child.stdout?.destroy();
			child.stderr?.destroy();
			child.unref();
		},
	};

	const deadline = Date.now() + opts.timeoutMs;
	while (Date.now() < deadline) {
		if (opts.signal?.aborted) {
			await server.stop();
			throw new Error("aborted while waiting for the dev server");
		}
		if (exited) {
			await server.stop();
			throw new DevServerError(
				`dev server command exited ${describeExit(exited)} before ${opts.url} responded: ${opts.command}`,
				server.outputTail(),
			);
		}
		if (await urlResponds(opts.url)) return server;
		await sleep(POLL_MS);
	}
	await server.stop();
	throw new DevServerError(
		`dev server did not respond at ${opts.url} within ${Math.round(opts.timeoutMs / 1000)}s: ${opts.command}`,
		server.outputTail(),
	);
}
