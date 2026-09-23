import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PERF_RULES } from "../src/checks/lighthouse.js";
import { ConnectionFailureCounter, isConnectionError, runAudit, TargetGoneError } from "../src/index.js";
import { hasChromium, makeProject, SKIP_BROWSER_REASON } from "./browser-helpers.js";

const CRASH = JSON.stringify(
	join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", "serve-then-crash.mjs"),
);
const ROUTES = ["/", "/about.html", "/holes.html", "/wide.html", "/login.html", "/a", "/b", "/c"];
// Lighthouse against a dead server burns ~30s before giving up; these tests are about the crawl.
const RULES = `extends: [gribble:recommended]\nrules:\n  ui/horizontal-overflow: error\n${PERF_RULES.map((r) => `  ${r}: off\n`).join("")}`;

async function freePort(): Promise<number> {
	return new Promise((resolve) => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const port = (server.address() as { port: number }).port;
			server.close(() => resolve(port));
		});
	});
}

describe("isConnectionError", () => {
	it("matches refused and dropped connections, not pages that answered badly", () => {
		expect(isConnectionError("page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8790/")).toBe(true);
		expect(isConnectionError("page.goto: net::ERR_EMPTY_RESPONSE at http://localhost:8790/")).toBe(true);
		expect(isConnectionError("fetch failed: connect ECONNREFUSED 127.0.0.1:8790")).toBe(true);
		expect(isConnectionError("page.goto: net::ERR_NAME_NOT_RESOLVED at http://nope.invalid/")).toBe(false);
		expect(isConnectionError("page.goto: Timeout 30000ms exceeded.")).toBe(false);
		expect(isConnectionError(undefined)).toBe(false);
	});
});

describe("ConnectionFailureCounter", () => {
	it("trips on the Nth consecutive connection error and resets on anything else", () => {
		const counter = new ConnectionFailureCounter(3);
		expect(counter.record("net::ERR_CONNECTION_REFUSED")).toBe(false);
		expect(counter.record("net::ERR_CONNECTION_REFUSED")).toBe(false);
		expect(counter.record(undefined)).toBe(false);
		expect(counter.record("page.goto: net::ERR_CONNECTION_RESET at /a")).toBe(false);
		expect(counter.record("page.goto: net::ERR_CONNECTION_REFUSED at /b")).toBe(false);
		expect(counter.record("page.goto: net::ERR_CONNECTION_REFUSED at /c")).toBe(true);
		expect(counter.count()).toBe(3);
		expect(counter.lastError()).toBe("net::ERR_CONNECTION_REFUSED");
	});

	it("never trips at 0", () => {
		const counter = new ConnectionFailureCounter(0);
		for (let i = 0; i < 10; i++) expect(counter.record("net::ERR_CONNECTION_REFUSED")).toBe(false);
	});
});

describe.skipIf(!hasChromium())(
	`runAudit when the dev server dies mid-crawl (${SKIP_BROWSER_REASON})`,
	() => {
		let dir: string | undefined;

		afterEach(async () => {
			if (dir) await rm(dir, { recursive: true, force: true });
			dir = undefined;
		});

		async function audit(mode: "exit" | "hang-up", extra = "") {
			const port = await freePort();
			dir = await mkdtemp(join(tmpdir(), "gribble-gone-"));
			const project = await makeProject({
				url: `http://127.0.0.1:${port}`,
				targetDir: dir,
				start: `node ${CRASH} ${port} 12 ${mode}`,
				rulesYaml: RULES,
				routes: ROUTES,
				gribbleYamlExtra: extra,
			});
			const started = Date.now();
			const routesStarted: string[] = [];
			const result = await runAudit({
				project,
				mode: "gate",
				ci: true,
				agentDir: dir,
				onEvent: (event) => {
					if (event.type === "route:start") routesStarted.push(`${event.route}@${event.viewport}`);
				},
			}).then(
				(report) => ({ report, error: undefined }),
				(error: unknown) => ({ report: undefined, error }),
			);
			return { ...result, project, routesStarted, durationMs: Date.now() - started };
		}

		it("stops as soon as the server process exits and carries its last output", async () => {
			const { error, project, durationMs } = await audit("exit");
			expect(error).toBeInstanceOf(TargetGoneError);
			const gone = error as TargetGoneError;
			expect(gone.message).toMatch(
				/^the dev server is gone: `node .*` exited with code 1 after \d+ of 8 route\(s\)/,
			);
			expect(gone.output).toContain("[stderr] kaboom: crashed after 12 request(s)");
			// A void run leaves neither a baseline nor a report behind.
			expect(existsSync(join(project.gribbleDir, "baseline"))).toBe(false);
			expect(existsSync(join(project.gribbleDir, "runs", "latest.json"))).toBe(false);
			expect(durationMs).toBeLessThan(60_000);
		}, 90_000);

		it("stops after N refused page loads when the process lingers without serving", async () => {
			const { error, routesStarted } = await audit("hang-up");
			expect(error).toBeInstanceOf(TargetGoneError);
			const gone = error as TargetGoneError;
			expect(gone.message).toMatch(
				/^the dev server is gone: 3 page loads in a row failed with net::ERR_CONNECTION_REFUSED after \d+ of 8 route\(s\), and http:\/\/127\.0\.0\.1:\d+ no longer answers\.$/,
			);
			expect(gone.output).toContain("[stderr] kaboom: crashed after 12 request(s)");
			// Two viewports per route: the crawl stopped long before the last one.
			expect(routesStarted).not.toContain("/c@mobile");
		}, 90_000);

		it("keeps going when the breaker is disabled, and the report says what failed", async () => {
			const { error, report } = await audit("hang-up", "  maxConnectionFailures: 0\n");
			expect(error).toBeUndefined();
			expect(report?.findings.some((f) => f.rule === "network/page-error" && f.route === "/c")).toBe(true);
		}, 120_000);
	},
);
