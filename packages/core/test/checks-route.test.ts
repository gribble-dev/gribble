import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
	AuditEvent,
	BrowserSession,
	CheckContext,
	ProjectContext,
	RouteCheckResult,
} from "../src/index.js";
import {
	checkSiteWide,
	compilePatterns,
	isHtmlMediaType,
	LinkCache,
	launchBrowser,
	makeFinding,
	mediaTypeOf,
	normalizeConsoleText,
	parseRobots,
	parseSitemapLocs,
	runRouteChecks,
	structureKeys,
} from "../src/index.js";
import {
	type FixtureSite,
	hasChromium,
	makeProject,
	SKIP_BROWSER_REASON,
	startFixtureSite,
} from "./browser-helpers.js";

describe("check helpers", () => {
	it("compilePatterns handles literals, regex and words", () => {
		const [lorem, todo, re] = compilePatterns(["lorem ipsum", "TODO", "^[a-z]+(\\.[a-z_]+)+$"], {
			word: true,
		});
		expect(lorem!.test("Lorem Ipsum dolor")).toBe(true);
		expect(todo!.test("todo list")).toBe(false);
		expect(todo!.test("TODO: fix")).toBe(true);
		expect(re!.test("home.hero.title")).toBe(true);
	});

	it("normalizeConsoleText collapses volatile parts", () => {
		expect(normalizeConsoleText("Failed to load http://x/a.js?v=123 after 42ms (abcdef1234567890)")).toBe(
			"Failed to load <url> after #ms (<hash>)",
		);
	});

	it("parseRobots and parseSitemapLocs read the fixture files", () => {
		expect(parseRobots("User-agent: *\nDisallow: /\n")).toEqual({
			directives: 2,
			disallowAll: true,
			sitemaps: [],
		});
		expect(parseRobots("<html>")).toBeUndefined();
		expect(
			parseSitemapLocs("<urlset><url><loc>http://x/</loc></url><url><loc> http://x/a </loc></url></urlset>"),
		).toEqual({
			kind: "urlset",
			locs: ["http://x/", "http://x/a"],
		});
	});

	it("mediaTypeOf and isHtmlMediaType read the document content type", () => {
		expect(mediaTypeOf("text/html; charset=utf-8")).toBe("text/html");
		expect(mediaTypeOf("Application/XML")).toBe("application/xml");
		expect(mediaTypeOf("")).toBeUndefined();
		expect(mediaTypeOf(undefined)).toBeUndefined();
		expect(isHtmlMediaType("text/html; charset=utf-8")).toBe(true);
		expect(isHtmlMediaType("application/xhtml+xml")).toBe(true);
		expect(isHtmlMediaType(undefined)).toBe(true); // no header: keep treating the page as HTML
		expect(isHtmlMediaType("application/xml")).toBe(false);
		expect(isHtmlMediaType("application/json; charset=utf-8")).toBe(false);
		expect(isHtmlMediaType("text/plain")).toBe(false);
	});

	it("structureKeys counts landmarks and headings", () => {
		const keys = structureKeys(
			'- navigation "Main":\n  - link "Home"\n- main:\n  - heading "Hi" [level=1]\n- form "Login"',
		);
		expect([...keys.keys()]).toEqual(['navigation "Main"', "main", 'heading "Hi"', 'form "Login"']);
	});
});

describe("makeFinding", () => {
	it("returns undefined for off rules and fills severity, docs and fingerprint otherwise", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gribble-finding-"));
		try {
			const project = await makeProject({
				url: "http://localhost:3000",
				targetDir: dir,
				rulesYaml: "rules:\n  links/broken: error\n",
			});
			const ctx = { project, route: "/Blog/42/", targetName: "apps/web", viewport: "desktop" };
			expect(makeFinding(ctx, "seo/title", { title: "x", message: "y" })).toBeUndefined();
			const finding = makeFinding(ctx, "links/broken", {
				title: "x",
				message: "y",
				subject: "http://x/nope",
				location: { selector: "a" },
			});
			expect(finding).toMatchObject({
				rule: "links/broken",
				severity: "error",
				source: "deterministic",
				status: "new",
				route: "/blog/[id]",
				viewport: "desktop",
				subject: "http://x/nope",
				docsUrl: "https://gribble.dev/rules/links/broken",
			});
			expect(finding?.fingerprint).toHaveLength(16);
			expect(finding?.suggestion).toContain("redirect");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

type CheckEnd = Extract<AuditEvent, { type: "check:end" }>;

describe.skipIf(!hasChromium())(`route checks (${SKIP_BROWSER_REASON})`, () => {
	let site: FixtureSite;
	let browser: BrowserSession;
	let dir: string;
	let project: ProjectContext;
	const events: AuditEvent[] = [];

	async function run(
		path: string,
		viewport = "desktop",
		opts: { lighthouse?: boolean; cdpPort?: number } = {},
	): Promise<RouteCheckResult & { ctx: CheckContext }> {
		const page = await browser.newPage({ viewport });
		const ctx: CheckContext = {
			project,
			page,
			route: path.replace(/\.html$/, "") === "/index" ? "/" : path,
			url: `${site.url}${path}`,
			viewport,
			targetName: "",
			runDir: join(dir, "run"),
			shared: { links: new LinkCache(), reportedOnce: new Set() },
			onEvent: (e) => events.push(e),
		};
		try {
			const result = await runRouteChecks(ctx, { lighthouse: false, screenshot: true, ...opts });
			return { ...result, ctx };
		} finally {
			await page.close();
		}
	}

	beforeAll(async () => {
		site = await startFixtureSite();
		dir = await mkdtemp(join(tmpdir(), "gribble-checks-"));
		project = await makeProject({
			url: site.url,
			targetDir: dir,
			rulesYaml:
				"extends: [gribble:recommended]\nrules:\n  ui/overlap: error\n  ui/horizontal-overflow: error\n  ui/min-font-size: warn\n  ui/favicon: warn\n  ui/broken-images: error\n  a11y/touch-target: warn\n  seo/canonical: off\n",
		});
		browser = await launchBrowser({ project, headless: true });
	}, 60_000);

	afterAll(async () => {
		await browser?.close();
		await site?.close();
		await rm(dir, { recursive: true, force: true });
	});

	it("finds the deliberate holes", async () => {
		const { findings, ariaSnapshot, screenshot, title, status } = await run("/holes.html");
		const rules = findings.map((f) => f.rule);
		expect(status).toBe(200);
		expect(title).toContain("Holes");
		expect(ariaSnapshot).toContain("heading");
		expect(screenshot?.length).toBeGreaterThan(100);

		const broken = findings.find((f) => f.rule === "links/broken");
		expect(broken?.subject).toBe(`${site.url}/nope`);
		expect(broken?.location?.selector).toBe('[data-testid="broken-link"]');
		expect(broken?.severity).toBe("error");

		expect(rules).toContain("a11y/img-alt");
		expect(findings.find((f) => f.rule === "html/duplicate-ids")?.subject).toBe("hero");
		expect(findings.find((f) => f.rule === "ui/placeholder-text")?.subject).toBe("lorem ipsum");
		expect(findings.find((f) => f.rule === "i18n/untranslated-keys")?.subject).toBe("home.hero.title");
		expect(findings.find((f) => f.rule === "links/empty-href")?.subject).toBe("#");
		expect(findings.find((f) => f.rule === "ui/broken-images")?.subject).toBe(
			`${site.url}/assets/missing.png`,
		);
		expect(findings.find((f) => f.rule === "network/failed-requests")?.subject).toBe(
			`${site.url}/assets/missing.png`,
		);
		expect(rules).toContain("ui/favicon");
		expect(rules).not.toContain("seo/title");
		expect(rules).not.toContain("network/page-error");
		for (const f of findings) {
			expect(f.source).toBe("deterministic");
			expect(f.status).toBe("new");
			expect(f.route).toBe("/holes.html");
			expect(f.fingerprint).toHaveLength(16);
			expect(f.docsUrl).toBe(`https://gribble.dev/rules/${f.rule}`);
		}
		expect(events.some((e) => e.type === "check:start" && e.rule === "links/*")).toBe(true);
		expect(events.filter((e) => e.type === "finding").length).toBeGreaterThan(0);
	}, 60_000);

	it("reports heading problems and missing metadata", async () => {
		const headings = await run("/headings.html");
		expect(headings.findings.find((f) => f.rule === "seo/single-h1")?.subject).toBe("multiple");
		expect(headings.findings.find((f) => f.rule === "seo/heading-order")?.title).toContain("h2 to h4");

		const untitled = await run("/untitled.html");
		const rules = untitled.findings.map((f) => f.rule);
		expect(untitled.findings.find((f) => f.rule === "seo/title")?.subject).toBe("missing");
		expect(rules).toContain("seo/lang-attribute");
		expect(rules).toContain("html/viewport-meta");
		expect(rules).toContain("seo/meta-description");
		expect(rules).toContain("a11y/form-labels");
	}, 60_000);

	it("skips the page rules on a non-HTML response and records them as not run", async () => {
		events.length = 0;
		const result = await run("/sitemap.xml");
		expect(result.status).toBe(200);
		const rules = result.findings.map((f) => f.rule);
		expect(rules.filter((r) => /^(html|seo|a11y|links|ui|i18n)\//.test(r))).toEqual([]);
		const notRun = result.notRun ?? [];
		expect(notRun.map((n) => n.rule)).toEqual(["html/*", "seo/*", "links/*", "ui/*", "i18n/*", "a11y/*"]);
		for (const entry of notRun) {
			expect(entry.route).toBe("/sitemap.xml");
			expect(entry.reason).toBe("response is application/xml, not an HTML document; page rules skipped");
		}
		const ended = events.filter(
			(e): e is CheckEnd => e.type === "check:end" && e.route === "/sitemap.xml",
		);
		expect(ended.filter((e) => e.ok === false).map((e) => e.rule)).toEqual(notRun.map((n) => n.rule));
		expect(ended.filter((e) => e.ok === true).map((e) => e.rule)).toEqual(["network/*", "security/*"]);
		expect(
			events.some(
				(e) =>
					e.type === "log" && e.level === "info" && e.message.startsWith("/sitemap.xml is application/xml;"),
			),
		).toBe(true);
	}, 60_000);

	it("records perf/* as not run when Lighthouse cannot start", async () => {
		events.length = 0;
		const result = await run("/about.html", "desktop", { lighthouse: true, cdpPort: undefined });
		expect(result.findings.map((f) => f.rule).filter((r) => r.startsWith("perf/"))).toEqual([]);
		expect(result.notRun).toEqual([
			{
				rule: "perf/*",
				route: "/about.html",
				reason: "Lighthouse could not run: no CDP port for the browser session",
			},
		]);
		const perf = events.find((e) => e.type === "check:end" && e.rule === "perf/*");
		expect(perf).toMatchObject({
			ok: false,
			route: "/about.html",
			error: "Lighthouse could not run: no CDP port for the browser session",
		});
		const html = events.filter((e): e is CheckEnd => e.type === "check:end" && e.rule === "html/*");
		expect(html.length).toBeGreaterThan(0);
		expect(html.every((e) => e.ok === true)).toBe(true);
	}, 60_000);

	it("reports a broken route as network/page-error and nothing else", async () => {
		const result = await run("/nope");
		expect(result.status).toBe(404);
		expect(result.findings.map((f) => f.rule)).toEqual(["network/page-error"]);
		expect(result.findings[0]?.severity).toBe("critical");
	});

	it("flags overlap and mobile overflow, and follows the viewport option", async () => {
		const overlap = await run("/overlap.html");
		expect(overlap.findings.find((f) => f.rule === "ui/overlap")?.location?.selector).toBe(
			'[data-testid="first"]',
		);

		const desktopWide = await run("/wide.html");
		expect(desktopWide.findings.map((f) => f.rule)).not.toContain("ui/horizontal-overflow");
		const mobileWide = await run("/wide.html", "mobile");
		const overflow = mobileWide.findings.find((f) => f.rule === "ui/horizontal-overflow");
		expect(overflow?.viewport).toBe("mobile");
		expect(mobileWide.findings.find((f) => f.rule === "ui/min-font-size")?.title).toContain("9px");
	}, 60_000);

	it("honors redirect chain limits and target=_blank", async () => {
		const about = await run("/about.html");
		expect(about.findings.find((f) => f.rule === "links/target-blank-noopener")?.subject).toBe(
			"https://example.com/",
		);
		const page = await browser.newPage();
		await page.goto(`${site.url}/`);
		await page.raw.evaluate(() => {
			const a = document.createElement("a");
			a.href = "/redirect-twice";
			a.textContent = "chain";
			document.body.append(a);
		});
		const ctx: CheckContext = {
			project,
			page,
			route: "/",
			url: `${site.url}/`,
			viewport: "desktop",
			targetName: "",
			runDir: join(dir, "run"),
			shared: { links: new LinkCache(), reportedOnce: new Set() },
		};
		const result = await runRouteChecks(ctx, { skipNavigation: true, screenshot: false });
		const chain = result.findings.find((f) => f.rule === "links/redirect-chain");
		expect(chain?.subject).toBe(`${site.url}/redirect-twice`);
		expect(chain?.suggestion).toContain("/about.html");
		await page.close();
	}, 60_000);

	it("runs the site-wide checks over the per-route results", async () => {
		const perRoute = new Map<string, RouteCheckResult>();
		for (const path of ["/", "/about.html", "/untitled.html"]) {
			const result = await run(path);
			perRoute.set(path, result);
		}
		const findings = await checkSiteWide({
			project,
			browser,
			routes: [...perRoute.keys()],
			perRoute,
			targetName: "",
			shared: { links: new LinkCache(), reportedOnce: new Set() },
		});
		const sitemap = findings.find((f) => f.rule === "seo/sitemap");
		expect(sitemap?.message).toContain("/untitled.html");
		expect(sitemap?.viewport).toBeUndefined();
		expect(findings.map((f) => f.rule)).not.toContain("seo/robots-txt");
		expect(findings.map((f) => f.rule)).not.toContain("seo/duplicate-title");
	}, 90_000);
});

describe.skipIf(!hasChromium() || process.env.GRIBBLE_TEST_LIGHTHOUSE !== "1")(
	"lighthouse (set GRIBBLE_TEST_LIGHTHOUSE=1)",
	() => {
		it("collects metrics over the session CDP port", async () => {
			const site = await startFixtureSite();
			const dir = await mkdtemp(join(tmpdir(), "gribble-lh-"));
			const project = await makeProject({ url: site.url, targetDir: dir });
			const browser = await launchBrowser({ project, headless: true });
			try {
				const page = await browser.newPage();
				const ctx: CheckContext = {
					project,
					page,
					route: "/",
					url: `${site.url}/`,
					viewport: "desktop",
					targetName: "",
					runDir: join(dir, "run"),
				};
				const result = await runRouteChecks(ctx, {
					lighthouse: true,
					cdpPort: browser.cdpPort(),
					screenshot: false,
				});
				expect(result.metrics.lighthousePerformance).toBeGreaterThan(0);
				expect(result.metrics.lcpMs).toBeGreaterThan(0);
				await page.close();
			} finally {
				await browser.close();
				await site.close();
				await rm(dir, { recursive: true, force: true });
			}
		}, 180_000);
	},
);
