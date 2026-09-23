import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DevServerError, startDevServer, urlResponds } from "../src/audit/dev-server.js";

const FIXTURES = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");
const SERVE = JSON.stringify(join(FIXTURES, "serve-site.mjs"));
const CRASH = JSON.stringify(join(FIXTURES, "serve-then-crash.mjs"));

async function freePort(): Promise<number> {
	return new Promise((resolve) => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const port = (server.address() as { port: number }).port;
			server.close(() => resolve(port));
		});
	});
}

/** Resolves to "pending" when `promise` has not settled within `ms`. */
function settledWithin<T>(promise: Promise<T>, ms: number): Promise<T | "pending"> {
	return Promise.race([promise, new Promise<"pending">((r) => setTimeout(() => r("pending"), ms))]);
}

describe("startDevServer", () => {
	it("rejects when the command exits before the URL responds, with its last output", async () => {
		const logs: string[] = [];
		const failure = startDevServer({
			command: process.platform === "win32" ? "echo boom 1>&2 & exit 1" : "echo boom >&2; exit 1",
			cwd: process.cwd(),
			url: "http://127.0.0.1:59999",
			timeoutMs: 10_000,
			onLog: (line) => logs.push(line),
		});
		await expect(failure).rejects.toThrow(/exited with code 1 before http:\/\/127\.0\.0\.1:59999 responded/);
		const err = await failure.catch((e: unknown) => e);
		expect(err).toBeInstanceOf(DevServerError);
		expect((err as DevServerError).output.join("\n")).toContain("[stderr] boom");
	});

	it("reports a crash after startup with the output tail", async () => {
		const port = await freePort();
		const url = `http://127.0.0.1:${port}`;
		// The readiness probe is response 1; the next request is the last one it serves.
		const server = await startDevServer({
			command: `node ${CRASH} ${port} 2 exit`,
			cwd: process.cwd(),
			url,
			timeoutMs: 20_000,
		});
		try {
			expect(await urlResponds(`${url}/about.html`)).toBe(true);
			expect(await server.unexpectedExit).toEqual({ code: 1, signal: null });
			expect(server.outputTail()).toEqual([`[stdout] ${url}`, "[stderr] kaboom: crashed after 2 request(s)"]);
		} finally {
			await server.stop();
		}
	}, 30_000);

	it("does not report the exit that stop() causes", async () => {
		const port = await freePort();
		const server = await startDevServer({
			command: `node ${SERVE} ${port}`,
			cwd: process.cwd(),
			url: `http://127.0.0.1:${port}`,
			timeoutMs: 20_000,
		});
		await server.stop();
		expect(await settledWithin(server.unexpectedExit, 300)).toBe("pending");
	}, 30_000);

	it.skipIf(process.platform === "win32")(
		"stops a server the shell left behind after exiting",
		async () => {
			// The shell exits on its own while the server it launched keeps our pipes open. Signalling
			// only the shell used to leave the server running and the CLI waiting on it forever.
			const port = await freePort();
			const url = `http://127.0.0.1:${port}`;
			const server = await startDevServer({
				command: `node ${SERVE} ${port} & sleep 2`,
				cwd: process.cwd(),
				url,
				timeoutMs: 20_000,
			});
			expect(await server.unexpectedExit).toEqual({ code: 0, signal: null });
			expect(await urlResponds(url)).toBe(true);
			await server.stop();
			expect(await urlResponds(url)).toBe(false);
		},
		30_000,
	);
});
