import { describe, expect, it } from "vitest";
import {
	createSlugger,
	parseFrontmatter,
	renderMarkdown,
	resolveDocLink,
	slugify,
} from "../src/lib/markdown";

describe("slugify", () => {
	it("turns a rule id into an anchor", () => {
		expect(slugify("links/broken")).toBe("links-broken");
		expect(slugify("perf/lighthouse-performance")).toBe("perf-lighthouse-performance");
	});

	it("trims punctuation and backticks", () => {
		expect(slugify("`seo/title-length` — options")).toBe("seo-title-length-options");
	});
});

describe("createSlugger", () => {
	it("disambiguates repeated headings", () => {
		const slug = createSlugger();
		expect(slug("Options")).toBe("options");
		expect(slug("Options")).toBe("options-2");
		expect(slug("Options")).toBe("options-3");
	});
});

describe("parseFrontmatter", () => {
	it("reads title, description and order", () => {
		const { frontmatter, body } = parseFrontmatter(
			["---", "title: Flows", "description: Walk the journeys.", "order: 40", "---", "", "Body text."].join(
				"\n",
			),
		);
		expect(frontmatter).toEqual({ title: "Flows", description: "Walk the journeys.", order: 40 });
		expect(body.trim()).toBe("Body text.");
	});

	it("leaves a document without frontmatter alone", () => {
		const { frontmatter, body } = parseFrontmatter("# Hello\n");
		expect(frontmatter).toEqual({});
		expect(body).toBe("# Hello\n");
	});
});

describe("resolveDocLink", () => {
	it("rewrites sibling markdown links", () => {
		expect(resolveDocLink("./baseline.md", "concepts/findings")).toBe("/docs/concepts/baseline");
		expect(resolveDocLink("flows.md", "getting-started")).toBe("/docs/flows");
	});

	it("walks up a folder", () => {
		expect(resolveDocLink("../flows.md#steps", "concepts/findings")).toBe("/docs/flows#steps");
	});

	it("leaves absolute, external and anchor links alone", () => {
		expect(resolveDocLink("/docs/flows", "index")).toBe("/docs/flows");
		expect(resolveDocLink("https://example.com/a.md", "index")).toBe("https://example.com/a.md");
		expect(resolveDocLink("#anchor", "index")).toBe("#anchor");
	});
});

describe("renderMarkdown", () => {
	it("gives headings ids and collects them", () => {
		const { html, headings } = renderMarkdown("## links/broken\n\nText.\n", {
			slug: "configuration/rules-reference",
		});
		expect(html).toContain('<h2 id="links-broken">');
		expect(headings).toEqual([{ depth: 2, id: "links-broken", text: "links/broken" }]);
	});

	it("rewrites internal markdown links", () => {
		const { html } = renderMarkdown("See [flows](../flows.md).", { slug: "concepts/baseline" });
		expect(html).toContain('href="/docs/flows"');
	});
});

describe("prompt fences", () => {
	it("renders a prompt card instead of a code block", () => {
		const { html } = renderMarkdown("```prompt\nAdd a flow for <checkout>.\n```\n", { slug: "flows" });
		expect(html).toContain('<figure class="prompt-card">');
		expect(html).toContain("Ask your agent");
		expect(html).toContain('<p class="prompt-text">Add a flow for &lt;checkout&gt;.</p>');
		expect(html).toContain("data-copy-prompt");
		expect(html).not.toContain("<pre");
	});
});
