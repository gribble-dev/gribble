import { describe, expect, it } from "vitest";
import { startDevServer } from "../src/audit/dev-server.js";

describe("startDevServer", () => {
	it("rejects when the command exits before the URL responds", async () => {
		const logs: string[] = [];
		await expect(
			startDevServer({
				command: process.platform === "win32" ? "exit 1" : "echo boom >&2; exit 1",
				cwd: process.cwd(),
				url: "http://127.0.0.1:59999",
				timeoutMs: 10_000,
				onLog: (line) => logs.push(line),
			}),
		).rejects.toThrow(/exited with code 1 before http:\/\/127\.0\.0\.1:59999 responded/);
	});
});
