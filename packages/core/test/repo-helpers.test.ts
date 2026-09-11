import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clearSourceIndex,
	discoverRoutes,
	lengthToPx,
	locationFor,
	mapDomToSource,
	normalizeColor,
	readDesignTokens,
	symbolAt,
} from "../src/index.js";

let dir: string;

async function write(files: Record<string, string>): Promise<void> {
	for (const [file, content] of Object.entries(files)) {
		await mkdir(dirname(join(dir, file)), { recursive: true });
		await writeFile(join(dir, file), content, "utf8");
	}
}

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "gribble-repo-"));
});

afterEach(async () => {
	clearSourceIndex(dir);
	await rm(dir, { recursive: true, force: true });
});

describe("discoverRoutes", () => {
	it("reads a Next.js app directory with groups, slots and dynamic segments", async () => {
		await write({
			"package.json": JSON.stringify({ dependencies: { next: "15.0.0" } }),
			"app/page.tsx": "",
			"app/(marketing)/pricing/page.tsx": "",
			"app/blog/[slug]/page.tsx": "",
			"app/docs/[[...path]]/page.tsx": "",
			"app/@modal/login/page.tsx": "",
			"app/_private/page.tsx": "",
			"app/api/route.ts": "",
		});
		const found = await discoverRoutes(dir);
		expect(found.framework).toBe("next-app");
		expect(found.routes).toEqual(["/", "/login", "/pricing", "/blog/[slug]", "/docs/[...path]"]);
		expect(found.source["/pricing"]).toBe("app/(marketing)/pricing/page.tsx");
	});

	it("reads the Next.js pages directory", async () => {
		await write({
			"next.config.js": "",
			"pages/index.tsx": "",
			"pages/about.tsx": "",
			"pages/_app.tsx": "",
			"pages/api/hello.ts": "",
			"pages/posts/[id].tsx": "",
		});
		const found = await discoverRoutes(dir);
		expect(found.framework).toBe("next-pages");
		expect(found.routes).toEqual(["/", "/about", "/posts/[id]"]);
	});

	it("reads SvelteKit, Nuxt, Astro and Remix layouts", async () => {
		await write({
			"svelte.config.js": "",
			"src/routes/+page.svelte": "",
			"src/routes/(app)/dashboard/+page.svelte": "",
			"src/routes/blog/[slug]/+page.svelte": "",
		});
		expect((await discoverRoutes(dir)).routes).toEqual(["/", "/dashboard", "/blog/[slug]"]);
		await rm(join(dir, "svelte.config.js"));
		await rm(join(dir, "src"), { recursive: true });

		await write({
			"nuxt.config.ts": "",
			"pages/index.vue": "",
			"pages/users/_id.vue": "",
			"pages/posts/[slug].vue": "",
		});
		const nuxt = await discoverRoutes(dir);
		expect(nuxt.framework).toBe("nuxt");
		expect(nuxt.routes).toEqual(["/", "/posts/[slug]", "/users/[id]"]);
		await rm(join(dir, "nuxt.config.ts"));
		await rm(join(dir, "pages"), { recursive: true });

		await write({
			"astro.config.mjs": "",
			"src/pages/index.astro": "",
			"src/pages/blog/[...slug].astro": "",
		});
		expect((await discoverRoutes(dir)).framework).toBe("astro");

		await rm(join(dir, "astro.config.mjs"));
		await rm(join(dir, "src"), { recursive: true });
		await write({
			"package.json": JSON.stringify({ dependencies: { "@remix-run/react": "2.0.0" } }),
			"app/routes/_index.tsx": "",
			"app/routes/blog.$slug.tsx": "",
			"app/routes/_auth.login.tsx": "",
			"app/routes/settings/route.tsx": "",
		});
		const remix = await discoverRoutes(dir);
		expect(remix.framework).toBe("remix");
		expect(remix.routes).toEqual(["/", "/login", "/settings", "/blog/[slug]"]);
	});

	it("returns no routes for an unknown layout", async () => {
		await write({ "README.md": "" });
		const found = await discoverRoutes(dir);
		expect(found.framework).toBeUndefined();
		expect(found.routes).toEqual([]);
	});
});

describe("readDesignTokens", () => {
	it("normalizes colors and lengths", () => {
		expect(normalizeColor("#ABC")).toBe("#aabbcc");
		expect(normalizeColor("#aabbccdd")).toBe("#aabbcc");
		expect(normalizeColor("rgb(255, 0, 0)")).toBe("#ff0000");
		expect(normalizeColor("hsl(120 100% 50%)")).toBe("#00ff00");
		expect(normalizeColor("var(--x)")).toBeUndefined();
		expect(lengthToPx("0.875rem")).toBe("14");
		expect(lengthToPx("12px")).toBe("12");
		expect(lengthToPx("auto")).toBeUndefined();
	});

	it("reads tailwind config, @theme blocks and :root custom properties", async () => {
		await write({
			"tailwind.config.ts": `export default { theme: { colors: { brand: "#1D4ED8", ink: "rgb(17, 24, 39)" }, fontSize: { sm: "0.875rem", base: ["1rem", { lineHeight: "1.5" }] }, spacing: { 1: "4px" } } };`,
			"src/app.css": `@theme { --color-accent: #f59e0b; --text-lg: 1.125rem; --spacing-2: 8px; }\n:root { --surface: hsl(0 0% 100%); --font-size-body: 16px; }`,
			"node_modules/pkg/x.css": ":root { --junk: #000000; }",
		});
		const tokens = await readDesignTokens(dir);
		expect([...tokens.colors].sort()).toEqual(["#111827", "#1d4ed8", "#f59e0b", "#ffffff"]);
		expect([...tokens.fontSizes].sort()).toEqual(["14", "16", "18"]);
		expect([...tokens.spacing].sort()).toEqual(["4", "8"]);
		expect(tokens.sources).toEqual(["tailwind.config.ts", "src/app.css"]);
	});
});

describe("mapDomToSource", () => {
	it("prefers data-testid literals, then ids, then unique text, and finds the component symbol", async () => {
		await write({
			"src/components/Hero.tsx": `export function Hero() {\n  return <section data-testid="hero"><h1 id="headline">Welcome aboard</h1></section>;\n}\n`,
			"src/components/Footer.tsx": `export const Footer = () => <footer>Welcome aboard</footer>;\n`,
			"app/page.tsx": `import { Hero } from "../src/components/Hero";\nexport default function Page() { return <Hero />; }\n`,
			"src/lib/Card.svelte": `<div class="card-shell">Card</div>`,
		});
		const byTestId = await mapDomToSource({ targetDir: dir, testId: "hero" });
		expect(byTestId[0]).toMatchObject({ file: "src/components/Hero.tsx", symbol: "Hero", score: 0.9 });
		expect(byTestId[0]?.reason).toContain("unique");

		const byId = await mapDomToSource({ targetDir: dir, id: "headline" });
		expect(byId[0]).toMatchObject({ file: "src/components/Hero.tsx", symbol: "Hero" });

		const byText = await mapDomToSource({ targetDir: dir, text: "Welcome aboard" });
		expect(byText).toHaveLength(2);
		expect(byText[0]?.score).toBeLessThan(0.7);
		expect(byText.map((m) => m.symbol).sort()).toEqual(["Footer", "Hero"]);

		const routeBoost = await mapDomToSource({
			targetDir: dir,
			text: "Hero",
			route: "/",
			routeSource: { "/": "app/page.tsx" },
		});
		expect(routeBoost[0]?.file).toBe("app/page.tsx");

		const byClass = await mapDomToSource({ targetDir: dir, className: "flex card-shell" });
		expect(byClass[0]).toMatchObject({ file: "src/lib/Card.svelte", symbol: "Card" });

		expect(await mapDomToSource({ targetDir: dir })).toEqual([]);
	});

	it("symbolAt picks the nearest declaration", () => {
		const text = "function Helper() {}\nexport default function Page() {\n  return null;\n}\n";
		expect(symbolAt("app/page.tsx", text, text.indexOf("return"))).toBe("Page");
		expect(symbolAt("src/routes/+page.svelte", "<h1>x</h1>", 0)).toBeUndefined();
		expect(symbolAt("src/Nav.vue", "<nav/>", 0)).toBe("Nav");
	});

	it("locationFor prefers good source matches and falls back to selectors", () => {
		expect(locationFor({ file: "a.tsx", symbol: "A", score: 0.9, reason: "" }, { selector: "#x" })).toEqual({
			file: "a.tsx",
			symbol: "A",
			selector: "#x",
		});
		expect(locationFor({ file: "a.tsx", score: 0.3, reason: "" }, { selector: "#x" })).toEqual({
			selector: "#x",
		});
		expect(locationFor(undefined, { path: "body > div" })).toEqual({ path: "body > div" });
	});
});
