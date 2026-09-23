import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
	AuditEvent,
	BrowserSession,
	CheckContext,
	DesignTokens,
	Finding,
	ProjectContext,
	RouteCheckResult,
} from "../src/index.js";
import {
	checkSiteWide,
	compilePatterns,
	HEADERS_LOOPBACK_REASON,
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
		// The fixture serves on loopback, so security/headers records its own skip; see the next test.
		const notRun = (result.notRun ?? []).filter((n) => n.rule !== "security/headers");
		// a11y/* appears twice: once for axe and once for the focus, keyboard and motion rules.
		expect(notRun.map((n) => n.rule)).toEqual([
			"html/*",
			"seo/*",
			"links/*",
			"ui/*",
			"i18n/*",
			"a11y/*",
			"a11y/*",
		]);
		for (const entry of notRun) {
			expect(entry.route).toBe("/sitemap.xml");
			expect(entry.reason).toBe("response is application/xml, not an HTML document; page rules skipped");
		}
		const ended = events.filter((e): e is CheckEnd => e.type === "check:end" && e.route === "/sitemap.xml");
		expect(ended.filter((e) => e.ok === false).map((e) => e.rule)).toEqual(notRun.map((n) => n.rule));
		expect(ended.filter((e) => e.ok === true).map((e) => e.rule)).toEqual(["network/*", "security/*"]);
		expect(
			events.some(
				(e) =>
					e.type === "log" && e.level === "info" && e.message.startsWith("/sitemap.xml is application/xml;"),
			),
		).toBe(true);
	}, 60_000);

	it("records security/headers as not run on a loopback target without failing the security checks", async () => {
		events.length = 0;
		const result = await run("/about.html");
		expect(result.findings.map((f) => f.rule)).not.toContain("security/headers");
		expect(result.notRun).toEqual([
			{ rule: "security/headers", route: "/about.html", reason: HEADERS_LOOPBACK_REASON },
		]);
		const security = events.find((e) => e.type === "check:end" && e.rule === "security/*");
		expect(security).toMatchObject({ ok: true, route: "/about.html" });
	}, 60_000);

	it("records perf/* as not run when Lighthouse cannot start", async () => {
		events.length = 0;
		const result = await run("/about.html", "desktop", { lighthouse: true, cdpPort: undefined });
		expect(result.findings.map((f) => f.rule).filter((r) => r.startsWith("perf/"))).toEqual([]);
		expect(result.notRun).toEqual([
			{ rule: "security/headers", route: "/about.html", reason: HEADERS_LOOPBACK_REASON },
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

	it("judges a same-origin link that redirects off-site by where it lands", async () => {
		// A second origin standing in for a partner site that blocks bots on one path and lost another.
		const partner = createServer((req, res) => {
			res.writeHead(req.url === "/blocked" ? 403 : req.url === "/gone" ? 404 : 200);
			res.end();
		});
		await new Promise<void>((resolve) => partner.listen(0, "127.0.0.1", resolve));
		const partnerUrl = `http://127.0.0.1:${(partner.address() as AddressInfo).port}`;
		const hop = (path: string) => `/go?to=${encodeURIComponent(`${partnerUrl}${path}`)}`;
		const check = async (ignore: string[]) => {
			const rulesDir = await mkdtemp(join(tmpdir(), "gribble-links-"));
			const page = await browser.newPage();
			try {
				const ctx: CheckContext = {
					project: await makeProject({
						url: site.url,
						targetDir: rulesDir,
						rulesYaml: `rules:\n  links/broken: error\n  links/broken-external: [warn, { ignore: ${JSON.stringify(ignore)} }]\n`,
					}),
					page,
					route: "/",
					url: `${site.url}/`,
					viewport: "desktop",
					targetName: "",
					runDir: join(rulesDir, "run"),
					shared: { links: new LinkCache(), reportedOnce: new Set() },
				};
				await page.goto(`${site.url}/`);
				await page.raw.evaluate(
					(hrefs) => {
						document.body.replaceChildren();
						for (const href of hrefs) {
							const a = document.createElement("a");
							a.href = href;
							a.textContent = "partner";
							document.body.append(a);
						}
					},
					[hop("/blocked"), hop("/gone"), hop("/ok")],
				);
				const { findings } = await runRouteChecks(ctx, { skipNavigation: true, screenshot: false });
				return findings.filter((f) => f.rule.startsWith("links/"));
			} finally {
				await page.close();
				await rm(rulesDir, { recursive: true, force: true });
			}
		};
		try {
			const findings = await check(["linkedin.com"]);
			expect(findings.map((f) => [f.rule, f.subject])).toEqual([
				["links/broken-external", `${site.url}${hop("/gone")}`],
			]);
			expect(findings[0]?.severity).toBe("warn");
			expect(findings[0]?.message).toContain(`redirects to ${partnerUrl}/gone`);
			expect(await check(["127.0.0.1"])).toEqual([]);
		} finally {
			await new Promise((resolve) => partner.close(resolve));
		}
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

const PLANNED_RULES = [
	"a11y/focus-visible",
	"a11y/keyboard-reachable",
	"a11y/skip-link",
	"a11y/reduced-motion",
	"ui/spacing-from-tokens",
	"ui/empty-state",
	"html/deprecated-elements",
	"html/valid",
	"security/form-without-csrf",
	"i18n/mixed-language",
	"i18n/lang-mismatch",
];

const NO_TOKENS: DesignTokens = { colors: new Set(), fontSizes: new Set(), spacing: new Set(), sources: [] };

describe.skipIf(!hasChromium())(`formerly planned rules (${SKIP_BROWSER_REASON})`, () => {
	let site: FixtureSite;
	let browser: BrowserSession;
	let dir: string;
	let project: ProjectContext;

	/** Run one route with only the eleven rules on (no preset), optionally with different settings. */
	async function run(
		path: string,
		opts: { rules?: string; tokens?: DesignTokens } = {},
	): Promise<RouteCheckResult> {
		const page = await browser.newPage({ viewport: "desktop" });
		const ctx: CheckContext = {
			project: opts.rules
				? await makeProject({ url: site.url, targetDir: dir, rulesYaml: opts.rules })
				: project,
			page,
			route: path,
			url: `${site.url}${path}`,
			viewport: "desktop",
			targetName: "",
			runDir: join(dir, "run"),
			tokens: opts.tokens ?? NO_TOKENS,
			shared: { links: new LinkCache(), reportedOnce: new Set() },
		};
		try {
			return await runRouteChecks(ctx, { lighthouse: false, screenshot: false });
		} finally {
			await page.close();
		}
	}

	const only = (result: RouteCheckResult, rule: string) => result.findings.filter((f) => f.rule === rule);
	const kindOf = (f: Finding) => (f.evidence?.data as { kind?: string } | undefined)?.kind;

	beforeAll(async () => {
		site = await startFixtureSite();
		dir = await mkdtemp(join(tmpdir(), "gribble-planned-"));
		project = await makeProject({
			url: site.url,
			targetDir: dir,
			rulesYaml: `rules:\n${PLANNED_RULES.map((r) => `  ${r}: warn`).join("\n")}\n`,
		});
		browser = await launchBrowser({ project, headless: true });
	}, 60_000);

	afterAll(async () => {
		await browser?.close();
		await site?.close();
		await rm(dir, { recursive: true, force: true });
	});

	it("runs every one of them on an HTML route", async () => {
		const events: AuditEvent[] = [];
		const page = await browser.newPage({ viewport: "desktop" });
		const ctx: CheckContext = {
			project,
			page,
			route: "/a11y.html",
			url: `${site.url}/a11y.html`,
			viewport: "desktop",
			targetName: "",
			runDir: join(dir, "run"),
			shared: { links: new LinkCache(), reportedOnce: new Set() },
			onEvent: (e) => events.push(e),
		};
		// The OS decides the default (Windows runners already prefer reduced motion), so the check
		// must hand back whatever it found, not a fixed value.
		const reducedMotion = () =>
			page.raw.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
		await page.goto(ctx.url);
		const reducedBefore = await reducedMotion();
		const result = await runRouteChecks(ctx, { lighthouse: false, screenshot: false });
		expect(result.notRun).toEqual([]);
		const ended = events.filter((e): e is CheckEnd => e.type === "check:end");
		expect(ended.filter((e) => e.rule === "a11y/*")).toHaveLength(2);
		expect(ended.every((e) => e.ok)).toBe(true);
		// focus-visible moves focus and reduced-motion emulates media; both are undone afterwards.
		expect(await page.raw.evaluate(() => document.activeElement === document.body)).toBe(true);
		expect(await reducedMotion()).toBe(reducedBefore);
		await page.close();
	}, 60_000);

	it("finds missing focus styles, mouse-only controls, the missing skip link and motion that ignores the preference", async () => {
		const result = await run("/a11y.html");
		expect(only(result, "a11y/keyboard-reachable").map((f) => f.subject)).toEqual([
			'[data-testid="mouse-card"]',
			'[data-testid="fake-button"]',
			'[data-testid="unreachable"]',
			'[data-testid="jumpy"]',
		]);
		const focus = only(result, "a11y/focus-visible");
		expect(focus.map((f) => f.location?.selector)).toEqual(["#no-ring"]);
		expect(focus[0]?.title).toContain("No focus ring");
		const skip = only(result, "a11y/skip-link");
		expect(skip).toHaveLength(1);
		expect(skip[0]?.subject).toBe("missing");
		expect(skip[0]?.message).toContain("7 tabbable elements");
		expect(only(result, "a11y/reduced-motion").map((f) => f.subject)).toEqual([
			"animation:spin",
			"transition:transform",
		]);
		expect(result.findings.map((f) => f.location?.selector)).not.toContain('[data-testid="safe"]');
	}, 60_000);

	it("stays quiet on a page with a skip link, focus styles, reachable controls and guarded motion", async () => {
		const result = await run("/a11y-clean.html");
		expect(result.findings.map((f) => f.rule).filter((r) => r.startsWith("a11y/"))).toEqual([]);
		// Two leading links are not enough navigation to need a skip link.
		expect(only(await run("/holes.html"), "a11y/skip-link")).toEqual([]);
	}, 60_000);

	it("reports obsolete markup and the structural errors in the served source", async () => {
		const result = await run("/markup.html");
		expect(only(result, "html/deprecated-elements").map((f) => f.subject)).toEqual([
			"center",
			"font",
			"marquee",
			"td[align]",
			"table[cellpadding]",
			"td[valign]",
		]);
		expect(only(result, "html/deprecated-elements")[0]?.location?.selector).toBe("#old-center");
		const valid = only(result, "html/valid");
		const kinds = new Set(valid.map((f) => kindOf(f)));
		expect([...kinds].sort()).toEqual([
			"block-in-p",
			"duplicate-attribute",
			"list-child",
			"nested-a",
			"self-closing",
			"stray-end-tag",
			"unclosed",
		]);
		expect(valid.find((f) => kindOf(f) === "duplicate-attribute")?.location?.path).toBe("document:26");
		expect(valid.some((f) => f.message.includes("<script"))).toBe(false);

		const ignored = await run("/markup.html", {
			rules: "rules:\n  html/valid: [warn, { ignore: ['appears more than once', '/no matching open/'] }]\n",
		});
		const remaining = new Set(only(ignored, "html/valid").map((f) => kindOf(f)));
		expect(remaining.has("duplicate-attribute")).toBe(false);
		expect(remaining.has("stray-end-tag")).toBe(false);
		expect(remaining.has("unclosed")).toBe(true);
	}, 60_000);

	it("keeps html/valid and html/deprecated-elements quiet on well-formed pages", async () => {
		for (const path of ["/", "/holes.html", "/login.html", "/about.html"]) {
			const result = await run(path);
			expect({
				path,
				rules: result.findings.map((f) => f.rule).filter((r) => r.startsWith("html/")),
			}).toEqual({
				path,
				rules: [],
			});
		}
	}, 60_000);

	it("flags a same-origin POST form without a token and leaves protected, external and GET forms alone", async () => {
		const result = await run("/forms.html");
		const csrf = only(result, "security/form-without-csrf");
		expect(csrf.map((f) => f.location?.selector)).toEqual(["#unprotected"]);
		expect(csrf[0]?.subject).toBe(`${site.url}/comments`);
		expect(only(await run("/login.html"), "security/form-without-csrf")).toEqual([]);
	}, 60_000);

	it("tells a mixed page from a mislabelled one and reads the locale from the URL", async () => {
		const mixed = await run("/mixed.html");
		const mix = only(mixed, "i18n/mixed-language");
		expect(mix).toHaveLength(1);
		expect(mix[0]?.subject).toBe("latin+cjk");
		expect(mix[0]?.message).toContain('<html lang="en">');
		expect(only(mixed, "i18n/lang-mismatch").map((f) => f.location?.selector)).toEqual([
			'[data-testid="wrong-lang"]',
		]);

		const zh = await run("/zh.html");
		expect(only(zh, "i18n/mixed-language")).toEqual([]);
		expect(only(zh, "i18n/lang-mismatch").map((f) => f.subject)).toEqual(["html:en"]);

		const de = await run("/de/index.html");
		expect(only(de, "i18n/lang-mismatch").map((f) => f.subject)).toEqual(["route:de"]);
		expect(only(de, "i18n/lang-mismatch")[0]?.suggestion).toContain('lang="de"');

		const home = await run("/");
		expect(home.findings.map((f) => f.rule).filter((r) => r.startsWith("i18n/"))).toEqual([]);
	}, 60_000);

	it("reports empty tables and lists without an explanation and skips the explained, loading and navigational ones", async () => {
		const result = await run("/empty.html");
		expect(only(result, "ui/empty-state").map((f) => f.subject)).toEqual(["#orders", "#crates"]);
		expect(only(result, "ui/empty-state")[0]?.title).toContain('"Orders"');
	}, 60_000);

	it("compares margins and paddings with the spacing tokens and allows the browser defaults", async () => {
		const tokens: DesignTokens = { ...NO_TOKENS, spacing: new Set(["8", "24", "4", "13"]) };
		const result = await run("/spacing.html", { tokens });
		const spacing = only(result, "ui/spacing-from-tokens");
		expect(spacing.length).toBeGreaterThan(0);
		// 16px on the box is off the scale; the 16px default margin of <p> and the 8px nav gap are not.
		expect(spacing.map((f) => f.location?.selector)).toEqual(
			spacing.map(() => expect.stringMatching(/^\[data-testid="(on|off)"\]$/)),
		);
		expect(spacing.map((f) => f.subject)).toContain("margin-top:16px");
		expect(spacing.map((f) => f.subject)).toContain("padding-top:7px");
		expect(spacing.map((f) => f.subject)).not.toContain("margin-top:13px");
		expect(only(await run("/spacing.html"), "ui/spacing-from-tokens")).toEqual([]);
	}, 60_000);
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
