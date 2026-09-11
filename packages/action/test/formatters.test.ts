import { describe, expect, it } from "vitest";
import { fallbackJUnit, fallbackMarkdownSummary, fallbackSarif } from "../src/fallback-formatters.js";
import { mergeJUnit, mergeSarif } from "../src/outputs.js";
import { buildSummaryMarkdown } from "../src/summary.js";
import { SUMMARY_MARKER } from "../src/types.js";
import { finding, loaded, report } from "./fixtures.js";

const sample = report({
	findings: [
		finding({
			fingerprint: "a",
			rule: "links/broken",
			severity: "error",
			location: { file: "src/a.ts", symbol: "Hero" },
			subject: "/dead",
		}),
		finding({
			fingerprint: "b",
			rule: "seo/title",
			severity: "warn",
			source: "ai",
			confidence: 0.8,
			status: "existing",
		}),
		finding({ fingerprint: "c", rule: "a11y/img-alt", severity: "info", status: "fixed" }),
	],
	flows: [
		{ name: "smoke", ok: true, kind: "replay", durationMs: 1000 },
		{ name: "checkout", ok: false, kind: "ai", durationMs: 2000, error: "Button not found" },
	],
});

describe("fallbackSarif", () => {
	it("produces a SARIF 2.1.0 document with rules and results", () => {
		const sarif = fallbackSarif(sample) as {
			version: string;
			runs: Array<{
				tool: { driver: { name: string; rules: Array<{ id: string }> } };
				results: Array<Record<string, unknown>>;
			}>;
		};
		expect(sarif.version).toBe("2.1.0");
		expect(sarif.runs).toHaveLength(1);
		const run = sarif.runs[0]!;
		expect(run.tool.driver.name).toBe("Gribble");
		expect(run.tool.driver.rules.map((r) => r.id)).toEqual(["a11y/img-alt", "links/broken", "seo/title"]);
		// fixed findings are not results
		expect(run.results).toHaveLength(2);
		expect(run.results[0]).toMatchObject({
			ruleId: "links/broken",
			level: "error",
			baselineState: "new",
			partialFingerprints: { "gribble/v1": "a" },
		});
		expect(run.results[1]).toMatchObject({
			ruleId: "seo/title",
			level: "warning",
			baselineState: "unchanged",
		});
		expect(JSON.stringify(run.results[0])).toContain('"uri":"src/a.ts"');
	});

	it("merges runs", () => {
		const merged = mergeSarif([fallbackSarif(sample), fallbackSarif(sample)]) as { runs: unknown[] };
		expect(merged.runs).toHaveLength(2);
	});
});

describe("fallbackJUnit", () => {
	it("produces testsuites with failures for blocking findings and flows", () => {
		const xml = fallbackJUnit(sample);
		expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<testsuites')).toBe(true);
		expect(xml).toContain('<testsuite name="gribble"');
		expect(xml).toMatch(/<testsuites[^>]*failures="2"/); // one error finding + one failed flow
		expect(xml).toMatch(/<testsuites[^>]*skipped="1"/); // existing finding
		expect(xml).toContain('<failure type="error"');
		expect(xml).toContain('name="flows/ai checkout"');
		expect(xml).toContain("Button not found");
		expect(xml).not.toContain("a11y/img-alt");
	});

	it("escapes XML and handles the empty case", () => {
		const xml = fallbackJUnit(report({ findings: [finding({ title: 'Bad <b> & "quotes"' })] }));
		expect(xml).toContain("Bad &lt;b&gt; &amp; &quot;quotes&quot;");
		expect(fallbackJUnit(report({ findings: [] }))).toContain("The gribbles went hungry");
	});

	it("merges suites", () => {
		const a = fallbackJUnit(report({ target: { name: "apps/web", url: "http://a" }, findings: [finding()] }));
		const b = fallbackJUnit(report({ target: { name: "apps/docs", url: "http://b" }, findings: [] }));
		const merged = mergeJUnit([a, b]);
		expect(merged.match(/<testsuite /g)).toHaveLength(2);
		expect(merged.match(/<testsuites /g)).toHaveLength(1);
		expect(merged).toContain('name="gribble:apps/web"');
		expect(merged).toMatch(/<testsuites[^>]*tests="2"/);
	});
});

describe("fallbackMarkdownSummary", () => {
	it("includes the marker, the counts and the cap note", () => {
		const md = fallbackMarkdownSummary(sample, { maxComments: 0, reportUrl: "https://x/report" });
		expect(md.startsWith(SUMMARY_MARKER)).toBe(true);
		expect(md).toContain("| 1 | 1 | 1 |");
		expect(md).toContain("Showing 0 of 1 holes. The rest are in the full report.");
		expect(md).toContain("[Full report](https://x/report)");
		expect(md).toContain("Patched since baseline");
		expect(md).toContain("Flows that did not complete");
	});
});

describe("buildSummaryMarkdown", () => {
	const formatters = {
		toMarkdownSummary: fallbackMarkdownSummary,
		toSarif: fallbackSarif,
		toJUnit: fallbackJUnit,
		sources: {
			toMarkdownSummary: "fallback" as const,
			toSarif: "fallback" as const,
			toJUnit: "fallback" as const,
		},
	};

	it("keeps exactly one marker and one section per app", () => {
		const md = buildSummaryMarkdown(
			[
				loaded(report({ target: { name: "apps/web", url: "http://a" } })),
				loaded(report({ target: { name: "apps/docs", url: "http://b" } })),
			],
			formatters,
			{ maxComments: 5 },
		);
		expect(md.split(SUMMARY_MARKER)).toHaveLength(2);
		expect(md).toContain("### apps/web");
		expect(md).toContain("### apps/docs");
		expect(md).toContain("2 apps audited");
	});

	it("passes the decision through", () => {
		const md = buildSummaryMarkdown([loaded(sample)], formatters, {
			maxComments: 5,
			decision: { fail: true, reason: "1 new finding at or above error (1 error).", count: 1 },
			failOn: "error",
		});
		expect(md).toContain("⛔ Step failed: 1 new finding at or above error (1 error). (fail-on: error)");
	});
});
