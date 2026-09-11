import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserSession } from "../src/index.js";
import { launchBrowser, secretValues, urlMatcher } from "../src/index.js";
import {
	type FixtureSite,
	hasChromium,
	makeProject,
	SKIP_BROWSER_REASON,
	startFixtureSite,
} from "./browser-helpers.js";

describe("urlMatcher", () => {
	it("matches paths, globs, absolute urls and regex literals", () => {
		expect(urlMatcher("/dashboard")("http://x/dashboard")).toBe(true);
		expect(urlMatcher("/dashboard")("http://x/dashboard?tab=1")).toBe(true);
		expect(urlMatcher("/dashboard")("http://x/dashboards")).toBe(false);
		expect(urlMatcher("/blog/*")("http://x/blog/hello")).toBe(true);
		expect(urlMatcher("/blog/*")("http://x/blog/a/b")).toBe(false);
		expect(urlMatcher("**/settings")("http://x/app/settings")).toBe(true);
		expect(urlMatcher("http://x/about")("http://x/about/")).toBe(true);
		expect(urlMatcher("/\\/blog\\/\\d+/")("http://x/blog/42")).toBe(true);
	});
});

describe("secretValues", () => {
	it("collects env values named by auth profiles", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gribble-secrets-"));
		try {
			const project = await makeProject({
				url: "http://localhost:3000",
				targetDir: dir,
				gribbleYamlExtra:
					"auth:\n  profiles:\n    user:\n      type: flow\n      flow: flows/login.md\n      env: { email: T_EMAIL, password: T_PASSWORD }\n    api:\n      type: header\n      name: Authorization\n      env: { value: T_TOKEN }\n",
			});
			const values = secretValues(project.config, {
				T_EMAIL: "a@b.c",
				T_PASSWORD: "hunter2",
				T_TOKEN: "tok-123",
			});
			expect(values.sort()).toEqual(["a@b.c", "hunter2", "tok-123"]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe.skipIf(!hasChromium())(`page snapshot (${SKIP_BROWSER_REASON})`, () => {
	let site: FixtureSite;
	let browser: BrowserSession;
	let dir: string;

	beforeAll(async () => {
		site = await startFixtureSite();
		dir = await mkdtemp(join(tmpdir(), "gribble-browser-"));
		const project = await makeProject({ url: site.url, targetDir: dir });
		browser = await launchBrowser({ project, headless: true });
	}, 60_000);

	afterAll(async () => {
		await browser?.close();
		await site?.close();
		await rm(dir, { recursive: true, force: true });
	});

	it("produces refs, a simplified DOM, aria and interactive boxes", async () => {
		const page = await browser.newPage({ viewport: "desktop" });
		const nav = await page.goto(`${site.url}/`);
		expect(nav.ok).toBe(true);
		expect(nav.status).toBe(200);
		const snapshot = await page.snapshot();
		expect(snapshot.title).toContain("Fixture Harbor");
		expect(snapshot.interactive.length).toBeGreaterThanOrEqual(9);
		const home = snapshot.interactive.find((e) => e.testId === "nav-home");
		expect(home).toMatchObject({ ref: "e1", role: "link", name: "Home", tag: "a", href: "/" });
		expect(home?.selector).toBe('[data-testid="nav-home"]');
		const button = snapshot.interactive.find((e) => e.testId === "hello-button");
		expect(button?.role).toBe("button");
		expect(button?.box.width).toBeGreaterThan(0);
		expect(snapshot.dom).toContain("ref=e1");
		expect(snapshot.dom).toContain("<h1>Welcome aboard</h1>");
		expect(snapshot.dom).not.toContain("<script");
		expect(snapshot.aria).toContain("navigation");
		expect(snapshot.aria).toContain("heading");
		expect(snapshot.layout).toEqual([]);
		expect(snapshot.metrics?.requestCount).toBeGreaterThanOrEqual(2);
		expect(await page.resolveRef("e1")).toMatchObject({ testId: "nav-home" });
		await page.close();
	});

	it("clicks by ref and waits for the url", async () => {
		const page = await browser.newPage();
		await page.goto(`${site.url}/`);
		const snapshot = await page.snapshot({ includeDom: false });
		const about = snapshot.interactive.find((e) => e.testId === "nav-about")!;
		await page.click(`ref=${about.ref}`);
		await page.waitFor({ url: "/about.html" });
		expect(page.url()).toBe(`${site.url}/about.html`);
		expect(await page.text("h1")).toBe("About");
		await page.close();
	});

	it("caps the DOM by pruning deep subtrees first", async () => {
		const page = await browser.newPage();
		await page.goto(`${site.url}/`);
		const snapshot = await page.snapshot({ maxChars: 200 });
		expect(snapshot.dom.length).toBeLessThanOrEqual(200);
		expect(snapshot.dom).toContain("<body");
		await page.close();
	});

	it("detects overlapping interactive elements", async () => {
		const page = await browser.newPage();
		await page.goto(`${site.url}/overlap.html`);
		const snapshot = await page.snapshot({ includeDom: false });
		const overlap = snapshot.layout.find((l) => l.kind === "overlap");
		expect(overlap).toBeDefined();
		expect(overlap?.selectors).toEqual(['[data-testid="first"]', '[data-testid="second"]']);
		await page.close();
	});

	it("detects horizontal overflow, small fonts and touch targets on mobile", async () => {
		const page = await browser.newPage({ viewport: "mobile" });
		expect(page.viewportSize.width).toBe(390);
		await page.goto(`${site.url}/wide.html`);
		const snapshot = await page.snapshot({ includeDom: false, minFontPx: 12, minTouchPx: 44 });
		const overflow = snapshot.layout.find((l) => l.kind === "overflow-x");
		expect(overflow?.detail).toContain("scrollWidth");
		expect(overflow?.selectors?.[0]).toBe("#banner");
		expect(snapshot.styles.some((s) => s.kind === "min-font-size" && s.value === "9px")).toBe(true);
		await page.close();
	});

	it("flags colors outside the design tokens and keeps token colors quiet", async () => {
		const page = await browser.newPage();
		await page.goto(`${site.url}/`);
		const strict = await page.snapshot({ includeDom: false, tokens: { colors: ["#ffffff"] } });
		expect(strict.styles.some((s) => s.kind === "color" && s.value === "#222222")).toBe(true);
		const lenient = await page.snapshot({
			includeDom: false,
			tokens: { colors: ["#222222", "#ffffff", "#0000ee", "#000000"] },
		});
		expect(lenient.styles.filter((s) => s.kind === "color" && s.property === "color")).toEqual([]);
		await page.close();
	});

	it("tracks console errors and failed requests since navigation", async () => {
		const page = await browser.newPage();
		await page.goto(`${site.url}/holes.html`);
		const failed = page.drainFailedRequests();
		expect(failed.some((f) => f.url.endsWith("/assets/missing.png") && f.status === 404)).toBe(true);
		expect(page.drainFailedRequests()).toEqual([]);
		await page.raw.evaluate(() => console.error("boom"));
		expect(page.drainConsole().some((c) => c.level === "error" && c.text === "boom")).toBe(true);
		await page.close();
	});

	it("reports a 404 navigation as not ok", async () => {
		const page = await browser.newPage();
		const nav = await page.goto(`${site.url}/nope`);
		expect(nav.ok).toBe(false);
		expect(nav.status).toBe(404);
		await page.close();
	});

	it("exposes a CDP endpoint", async () => {
		const endpoint = await browser.cdpEndpoint();
		expect(endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		const res = await fetch(`${endpoint}/json/version`);
		expect(res.ok).toBe(true);
	});
});
