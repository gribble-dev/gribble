import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserSession } from "../src/index.js";
import {
	launchBrowser,
	resolveRoutes,
	routePatternRegex,
	startDevServer,
	urlResponds,
} from "../src/index.js";
import {
	type FixtureSite,
	hasChromium,
	makeProject,
	SKIP_BROWSER_REASON,
	startFixtureSite,
} from "./browser-helpers.js";

const SERVE_SCRIPT = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", "serve-site.mjs");

async function freePort(): Promise<number> {
	const { createServer } = await import("node:net");
	return new Promise((resolve) => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const port = (server.address() as { port: number }).port;
			server.close(() => resolve(port));
		});
	});
}

describe("routePatternRegex", () => {
	it("matches dynamic and catch-all segments", () => {
		expect(routePatternRegex("/blog/[slug]").test("/blog/hello")).toBe(true);
		expect(routePatternRegex("/blog/[slug]").test("/blog/a/b")).toBe(false);
		expect(routePatternRegex("/docs/[...path]").test("/docs/a/b/c")).toBe(true);
		expect(routePatternRegex("/about").test("/about/")).toBe(true);
		expect(routePatternRegex("/about").test("/about-us")).toBe(false);
	});

	it("lets rest parameters match zero segments", () => {
		// `/docs/[...slug]` is what an optional catch-all compiles to, and it serves `/docs` itself.
		expect(routePatternRegex("/docs/[...path]").test("/docs")).toBe(true);
		expect(routePatternRegex("/docs/[...path]").test("/docs/")).toBe(true);
		expect(routePatternRegex("/docs/[...path]").test("/docs/a")).toBe(true);
		expect(routePatternRegex("/docs/[...path]").test("/docsy")).toBe(false);
		expect(routePatternRegex("/docs/[...path]").test("/other")).toBe(false);
		expect(routePatternRegex("/[...all]").test("/")).toBe(true);
		expect(routePatternRegex("/[...all]").test("/a/b")).toBe(true);
	});

	it("matches both variants SvelteKit optional parameters expand to", () => {
		// Discovery emits `/about` and `/[lang]/about` for `[[lang=locale]]/about/+page.svelte`,
		// so every segment reaching here is required and both canonical and prefixed URLs match.
		expect(routePatternRegex("/about").test("/about")).toBe(true);
		expect(routePatternRegex("/about").test("/fr/about")).toBe(false);
		expect(routePatternRegex("/[lang]/about").test("/fr/about")).toBe(true);
		expect(routePatternRegex("/[lang]/about").test("/about")).toBe(false);
		expect(routePatternRegex("/").test("/")).toBe(true);
	});
});

describe("startDevServer", () => {
	it("does not start anything when the url already responds", async () => {
		const site = await startFixtureSite();
		try {
			const server = await startDevServer({
				command: "false",
				cwd: process.cwd(),
				url: site.url,
				timeoutMs: 5_000,
			});
			expect(server.started).toBe(false);
			await server.stop();
		} finally {
			await site.close();
		}
	});

	it("spawns the command, waits for the url and kills the process tree", async () => {
		const port = await freePort();
		const url = `http://127.0.0.1:${port}`;
		const logs: string[] = [];
		const server = await startDevServer({
			command: `node ${JSON.stringify(SERVE_SCRIPT)} ${port}`,
			cwd: process.cwd(),
			url,
			timeoutMs: 20_000,
			onLog: (line) => logs.push(line),
		});
		expect(server.started).toBe(true);
		expect(server.pid).toBeGreaterThan(0);
		expect(await urlResponds(`${url}/about.html`)).toBe(true);
		await server.stop();
		expect(await urlResponds(url)).toBe(false);
		expect(logs.some((l) => l.includes(url))).toBe(true);
	}, 30_000);

	it("fails fast when the command exits", async () => {
		const port = await freePort();
		await expect(
			startDevServer({
				command: 'node -e "process.exit(3)"',
				cwd: process.cwd(),
				url: `http://127.0.0.1:${port}`,
				timeoutMs: 10_000,
			}),
		).rejects.toThrow(/exited with code 3/);
	}, 20_000);

	it("times out when the url never answers", async () => {
		const port = await freePort();
		await expect(
			startDevServer({
				command: 'node -e "setTimeout(() => {}, 60000)"',
				cwd: process.cwd(),
				url: `http://127.0.0.1:${port}`,
				timeoutMs: 1_500,
			}),
		).rejects.toThrow(/did not respond/);
	}, 20_000);
});

describe.skipIf(!hasChromium())(`resolveRoutes (${SKIP_BROWSER_REASON})`, () => {
	let site: FixtureSite;
	let browser: BrowserSession;
	let dir: string;

	beforeAll(async () => {
		site = await startFixtureSite();
		dir = await mkdtemp(join(tmpdir(), "gribble-routes-"));
		const project = await makeProject({ url: site.url, targetDir: dir });
		browser = await launchBrowser({ project, headless: true });
	}, 60_000);

	afterAll(async () => {
		await browser?.close();
		await site?.close();
		await rm(dir, { recursive: true, force: true });
	});

	it("crawls same-origin links when nothing is discovered", async () => {
		const project = await makeProject({ url: site.url, targetDir: dir });
		const resolved = await resolveRoutes({ project, browser, discovered: { routes: [], source: {} } });
		expect(resolved.routes).toContain("/");
		expect(resolved.routes).toContain("/about.html");
		expect(resolved.routes).toContain("/login.html");
		expect(resolved.urls["/about.html"]).toBe(`${site.url}/about.html`);
		expect(resolved.incremental).toBe(false);
	}, 60_000);

	it("uses the configured list and the requested override", async () => {
		const project = await makeProject({
			url: site.url,
			targetDir: dir,
			routes: ["/about.html", "/holes.html"],
		});
		const fromConfig = await resolveRoutes({ project, browser, discovered: { routes: [], source: {} } });
		expect(fromConfig.routes).toEqual(["/about.html", "/holes.html"]);
		const requested = await resolveRoutes({
			project,
			browser,
			discovered: { routes: [], source: {} },
			requested: ["/wide.html"],
		});
		expect(requested.routes).toEqual(["/wide.html"]);
		expect(requested.urls["/wide.html"]).toBe(`${site.url}/wide.html`);
	});

	it("resolves dynamic routes by crawling and narrows to changed files", async () => {
		const project = await makeProject({ url: site.url, targetDir: dir });
		const discovered = {
			framework: "next-app" as const,
			routes: ["/", "/about.html", "/[page]", "/blog/[slug]"],
			source: {
				"/": "app/page.tsx",
				"/about.html": "app/about/page.tsx",
				"/[page]": "app/[page]/page.tsx",
				"/blog/[slug]": "app/blog/[slug]/page.tsx",
			},
		};
		const resolved = await resolveRoutes({ project, browser, discovered });
		expect(resolved.routes).toContain("/[page]");
		expect(resolved.urls["/[page]"]).toMatch(new RegExp(`^${site.url}/[a-z]+\\.html$`));
		expect(resolved.skipped).toEqual(["/blog/[slug]"]);

		const narrowed = await resolveRoutes({
			project,
			browser,
			discovered,
			changedFiles: ["app/about/page.tsx"],
		});
		expect(narrowed.routes).toEqual(["/about.html"]);
		expect(narrowed.incremental).toBe(true);

		const shared = await resolveRoutes({
			project,
			browser,
			discovered,
			changedFiles: ["components/Button.tsx"],
		});
		expect(shared.incremental).toBe(false);
		expect(shared.routes).toContain("/");
	}, 90_000);
});
