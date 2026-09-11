import { describe, expect, it } from "vitest";
import { BROWSER_TOOLS, browserPack, formatSnapshot, summarizeForPrompt } from "../src/index.js";
import { element, fakeBrowser, fakePi, fakeState, snapshot } from "./agent-helpers.js";
import { finding } from "./helpers.js";

describe("formatSnapshot", () => {
	it("renders title, aria, one line per interactive element, issues, and the DOM only on request", () => {
		const snap = snapshot({
			interactive: [
				element({ ref: "e12", role: "button", name: "Sign in", testId: "login" }),
				element({ ref: "e13", role: "link", name: "Docs", tag: "a", href: "/docs", id: "docs-link" }),
				element({ ref: "e14", role: "button", name: "Disabled", disabled: true }),
			],
			layout: [{ kind: "overlap", refs: ["e12", "e13"], detail: "button overlaps link" }],
			styles: [
				{
					kind: "color",
					ref: "e12",
					selector: "#login",
					property: "color",
					value: "#123456",
					expected: "a token color",
				},
			],
			console: [
				{ level: "error", text: "Uncaught TypeError" },
				{ level: "log", text: "noise" },
			],
			failedRequests: [{ url: "http://localhost:3000/api/x", method: "GET", status: 500 }],
			metrics: { domNodes: 120, requestCount: 9, transferKb: 340 },
		});
		const text = formatSnapshot(snap);
		expect(text).toContain("# Home");
		expect(text).toContain("url: http://localhost:3000/  status: 200");
		expect(text).toContain("dom nodes: 120  requests: 9  transfer: 340 kB");
		expect(text).toContain('e12 button "Sign in" [data-testid=login]');
		expect(text).toContain('e13 link "Docs" [#docs-link href=/docs]');
		expect(text).toContain('e14 button "Disabled" [disabled]');
		expect(text).toContain("- overlap [e12, e13]: button overlaps link");
		expect(text).toContain("- e12 #login: color=#123456 (expected a token color)");
		expect(text).toContain("- [error] Uncaught TypeError");
		expect(text).not.toContain("noise");
		expect(text).toContain("- GET http://localhost:3000/api/x -> 500");
		expect(text).not.toContain("## Simplified DOM");
		expect(formatSnapshot(snap, { includeDom: true })).toContain("## Simplified DOM");
		expect(formatSnapshot(snapshot({ aria: "" }))).toContain("## Simplified DOM");
	});

	it("truncates at maxChars", () => {
		const text = formatSnapshot(snapshot({ aria: "x".repeat(5000) }), { maxChars: 1000 });
		expect(text.length).toBeLessThan(1100);
		expect(text).toContain("[snapshot truncated at 1000 characters]");
	});
});

describe("page_snapshot tool", () => {
	it("stores the snapshot on the state and tracks the route", async () => {
		const browser = fakeBrowser();
		const state = fakeState({ browser });
		const h = fakePi();
		await h.load(browserPack(state));
		await h.call(BROWSER_TOOLS.navigate, { url: "/blog/42" });
		const result = await h.call(BROWSER_TOOLS.pageSnapshot, {});
		expect(result.content[0]?.text).toContain("# Home");
		expect(state.lastSnapshot?.url).toBe("http://localhost:3000/blog/42");
		expect(state.currentRoute).toBe("/blog/[id]");
		expect(h.tools.has(BROWSER_TOOLS.setViewport)).toBe(true);
		expect(h.tools.has(BROWSER_TOOLS.screenshot)).toBe(false);
	});

	it("set_viewport opens a second page at the current URL", async () => {
		const browser = fakeBrowser();
		const state = fakeState({ browser });
		const h = fakePi();
		await h.load(browserPack(state));
		await h.call(BROWSER_TOOLS.navigate, { url: "/pricing" });
		const result = await h.call(BROWSER_TOOLS.setViewport, { viewport: "mobile" });
		expect(result.content[0]?.text).toContain("mobile (390x844)");
		expect(browser.pages.mobile?.url()).toBe("http://localhost:3000/pricing");
		expect(state.currentViewport).toBe("mobile");
		await expect(h.call(BROWSER_TOOLS.setViewport, { viewport: "tv" })).rejects.toThrow(/Unknown viewport/);
	});

	it("fill requires a value or a secret_env that is set", async () => {
		const state = fakeState({ env: {} });
		const h = fakePi();
		await h.load(browserPack(state));
		await expect(h.call(BROWSER_TOOLS.fill, { target: "#x" })).rejects.toThrow(/value/);
		await expect(h.call(BROWSER_TOOLS.fill, { target: "#x", secret_env: "NOPE" })).rejects.toThrow(/NOPE/);
	});
});

describe("summarizeForPrompt", () => {
	it("groups deterministic findings by rule, severity first, and caps the list", () => {
		const findings = [
			finding({ rule: "seo/title", route: "/", title: "Missing title", severity: "warn" }),
			finding({
				rule: "links/broken",
				route: "/pricing",
				title: "Broken link",
				severity: "error",
				subject: "/dead",
			}),
			finding({
				rule: "links/broken",
				route: "/",
				title: "Broken link",
				severity: "error",
				subject: "/gone",
				location: { file: "src/Nav.tsx", symbol: "Nav" },
			}),
			finding({ rule: "review/ux", route: "/", title: "AI thing", source: "ai", confidence: 0.9 }),
		];
		const text = summarizeForPrompt(findings);
		const lines = text.split("\n");
		expect(lines[0]).toBe("- **links/broken** (2)");
		expect(text).toContain("  - error · /pricing · Broken link · subject: /dead");
		expect(text).toContain("at src/Nav.tsx#Nav");
		expect(text).toContain("- **seo/title** (1)");
		expect(text).not.toContain("AI thing");
		expect(summarizeForPrompt(findings, { max: 1 })).toContain("_2 more not shown._");
		expect(summarizeForPrompt([])).toBe("_No deterministic findings._");
	});
});
