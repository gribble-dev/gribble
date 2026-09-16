import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
	applyRulePolicy,
	capSeverity,
	computeFingerprint,
	dedupeFindings,
	normalizeRoute,
	parseRulesConfig,
	reportJsonSchema,
	reportSchema,
	resolveRules,
	sortFindings,
	summarizeReport,
	toCodeQuality,
	toJUnit,
	toMarkdownSummary,
	toSarif,
	writeRunReport,
} from "../src/index.js";
import { finding, report, withTempDir } from "./helpers.js";

describe("normalizeRoute", () => {
	it("normalizes case, slashes, query and ids", () => {
		expect(normalizeRoute("/Blog/Post/")).toBe("/blog/post");
		expect(normalizeRoute("/")).toBe("/");
		expect(normalizeRoute("")).toBe("/");
		expect(normalizeRoute("/users/42?tab=1#x")).toBe("/users/[id]");
		expect(normalizeRoute("/orders/3f2504e0-4f89-11d3-9a0c-0305e82c3301/items")).toBe("/orders/[id]/items");
		expect(normalizeRoute("http://localhost:3000/pricing/")).toBe("/pricing");
		expect(normalizeRoute("/blog/[slug]")).toBe("/blog/[slug]");
		expect(normalizeRoute("pricing")).toBe("/pricing");
	});
});

describe("computeFingerprint", () => {
	it("is 16 hex chars and stable across route variants", () => {
		const a = computeFingerprint({ rule: "links/broken", route: "/Blog/1/", subject: "/dead" });
		const b = computeFingerprint({ rule: "links/broken", route: "/blog/2", subject: "/dead" });
		expect(a).toMatch(/^[0-9a-f]{16}$/);
		expect(a).toBe(b);
	});

	it("prefers file#symbol over selector over path and includes target", () => {
		const base = { rule: "ui/overlap", route: "/x" };
		const withFile = computeFingerprint({
			...base,
			location: { file: "a.tsx", symbol: "Nav", selector: "#s" },
		});
		const withFileOnly = computeFingerprint({ ...base, location: { file: "a.tsx", symbol: "Nav" } });
		const withSelector = computeFingerprint({ ...base, location: { selector: "#s", path: "body>div" } });
		const withPath = computeFingerprint({ ...base, location: { path: "body>div" } });
		expect(withFile).toBe(withFileOnly);
		expect(withSelector).not.toBe(withFile);
		expect(withPath).not.toBe(withSelector);
		expect(computeFingerprint({ ...base, targetName: "apps/web" })).not.toBe(computeFingerprint(base));
	});
});

describe("dedupe / sort / cap", () => {
	it("dedupes exact fingerprints keeping the higher severity", () => {
		const a = finding({ rule: "links/broken", route: "/", title: "x", severity: "warn" });
		const b = { ...a, severity: "error" as const };
		const out = dedupeFindings([a, b]);
		expect(out).toHaveLength(1);
		expect(out[0]?.severity).toBe("error");
	});

	it("fuzzy-dedupes ai findings with similar titles on the same route and rule", () => {
		const a = finding({
			rule: "review/copy",
			route: "/pricing",
			title: "Typo in the hero heading: 'recieve'",
			source: "ai",
			subject: "hero",
			confidence: 0.9,
		});
		const b = finding({
			rule: "review/copy",
			route: "/pricing/",
			title: "Typo in the hero heading 'recieve'.",
			source: "ai",
			subject: "hero-2",
			confidence: 0.8,
		});
		const c = finding({
			rule: "review/copy",
			route: "/about",
			title: "Typo in the hero heading: 'recieve'",
			source: "ai",
			subject: "hero",
			confidence: 0.9,
		});
		const d = finding({
			rule: "review/copy",
			route: "/pricing",
			title: "Inconsistent product name in footer",
			source: "ai",
			subject: "footer",
			confidence: 0.9,
		});
		expect(a.fingerprint).not.toBe(b.fingerprint);
		expect(dedupeFindings([a, b, c, d]).map((f) => f.subject)).toEqual(["hero", "hero", "footer"]);
	});

	it("does not fuzzy-dedupe deterministic findings", () => {
		const a = finding({ rule: "links/broken", route: "/", title: "Broken link /a", subject: "/a" });
		const b = finding({ rule: "links/broken", route: "/", title: "Broken link /b", subject: "/b" });
		expect(dedupeFindings([a, b])).toHaveLength(2);
	});

	it("sorts by severity, confidence, then deterministic first", () => {
		const list = [
			finding({
				rule: "review/ux",
				route: "/",
				title: "ai warn",
				source: "ai",
				confidence: 0.9,
				subject: "1",
			}),
			finding({ rule: "links/broken", route: "/", title: "det warn", subject: "2" }),
			finding({
				rule: "review/ux",
				route: "/",
				title: "ai error",
				source: "ai",
				severity: "error",
				confidence: 0.7,
				subject: "3",
			}),
			finding({
				rule: "network/page-error",
				route: "/",
				title: "critical",
				severity: "critical",
				subject: "4",
			}),
			finding({
				rule: "review/ux",
				route: "/",
				title: "ai warn low",
				source: "ai",
				confidence: 0.5,
				subject: "5",
			}),
			finding({ rule: "seo/title", route: "/", title: "info", severity: "info", subject: "6" }),
		];
		expect(sortFindings(list).map((f) => f.title)).toEqual([
			"critical",
			"ai error",
			"det warn",
			"ai warn",
			"ai warn low",
			"info",
		]);
	});

	it("caps ai severities by the review rule and applies policy", () => {
		const rules = resolveRules([
			parseRulesConfig(
				"extends: [gribble:recommended]\nrules: { review/copy: off }\nignore: [deadbeefdeadbeef]",
			),
		]);
		const ai = finding({
			rule: "review/ux",
			route: "/",
			title: "t",
			source: "ai",
			severity: "critical",
			confidence: 0.9,
		});
		expect(capSeverity(ai, rules).severity).toBe("warn");
		const det = finding({ rule: "links/broken", route: "/", title: "t", severity: "critical" });
		expect(capSeverity(det, rules).severity).toBe("critical");
		const low = finding({
			rule: "review/ux",
			route: "/",
			title: "low",
			source: "ai",
			confidence: 0.2,
			subject: "l",
		});
		const off = finding({
			rule: "review/copy",
			route: "/",
			title: "off",
			source: "ai",
			confidence: 0.9,
			subject: "o",
		});
		const ignored = { ...det, fingerprint: "deadbeefdeadbeef" };
		const kept = applyRulePolicy([ai, det, low, off, ignored], rules, { minConfidence: 0.7 });
		expect(kept.map((f) => f.title)).toEqual(["t", "t"]);
		expect(kept[0]?.severity).toBe("warn");
	});
});

describe("summarizeReport", () => {
	it("says the gribbles went hungry when nothing is found", () => {
		const s = summarizeReport([]);
		expect(s.headline).toBe("The gribbles went hungry. Ship it.");
		expect(s.gate).toBe("pass");
	});

	it("counts blocking holes", () => {
		const s = summarizeReport([
			finding({ rule: "links/broken", route: "/", title: "a", severity: "error", subject: "a" }),
			finding({ rule: "network/page-error", route: "/x", title: "b", severity: "critical", subject: "b" }),
			finding({ rule: "seo/title", route: "/", title: "c", severity: "warn", subject: "c" }),
			finding({
				rule: "review/ux",
				route: "/",
				title: "d",
				severity: "error",
				source: "ai",
				confidence: 0.9,
				subject: "d",
			}),
			finding({
				rule: "links/broken",
				route: "/",
				title: "e",
				severity: "error",
				status: "existing",
				subject: "e",
			}),
		]);
		expect(s.headline).toBe("The gribbles found 4 holes in your hull — 2 need patching before you sail.");
		expect(s.gate).toBe("fail");
		expect(s.counts).toEqual({ critical: 1, error: 2, warn: 1, info: 0 });
		expect(s.newCount).toBe(4);
		expect(s.existingCount).toBe(1);
	});

	it("uses singular forms and the non-blocking line", () => {
		expect(
			summarizeReport([finding({ rule: "links/broken", route: "/", title: "a", severity: "error" })])
				.headline,
		).toBe("The gribbles found 1 hole in your hull — 1 needs patching before you sail.");
		expect(
			summarizeReport([finding({ rule: "seo/title", route: "/", title: "a", severity: "warn" })]).headline,
		).toBe("The gribbles found 1 hole in your hull. None are below the waterline.");
		expect(summarizeReport([], { fixedCount: 2 }).fixedCount).toBe(2);
	});
});

describe("toMarkdownSummary", () => {
	it("starts with the summary marker and lists capped findings with fingerprints", () => {
		const findings = Array.from({ length: 12 }, (_, i) =>
			finding({
				rule: "links/broken",
				route: `/p${i}`,
				title: `Broken link ${i}`,
				severity: "error",
				subject: `/dead${i}`,
				location: { file: "src/app/page.tsx", symbol: "Page" },
			}),
		);
		const rep = report(findings, {
			fixed: [{ fingerprint: "abcabcabcabcabca", rule: "seo/title", severity: "warn", route: "/old" }],
		});
		rep.summary.existingCount = 3;
		const md = toMarkdownSummary(rep, { maxComments: 5, reportUrl: "https://ci/run/1" });
		expect(md.split("\n")[0]).toBe("<!-- gribble:summary -->");
		expect(md).toContain("❌ fail");
		expect(md).toContain("| critical | 0 |");
		expect(md).toContain("| error | 12 |");
		expect(md).toContain("Showing 5 of 12 holes. The rest are in the full report.");
		expect(md.match(/<!-- gribble:fp:[0-9a-f]{16} -->/g)).toHaveLength(6);
		expect(md).toContain("[links/broken](https://gribble.dev/rules/links/broken)");
		expect(md).toContain("`src/app/page.tsx#Page`");
		expect(md).toContain("### Patched ✅");
		expect(md).toContain("<!-- gribble:fp:abcabcabcabcabca -->");
		expect(md).toContain("3 known holes from the baseline are not repeated here");
		expect(md).toContain("[Full report](https://ci/run/1)");
	});

	it("omits the new holes section when clean", () => {
		const md = toMarkdownSummary(report([]));
		expect(md).toContain("The gribbles went hungry. Ship it.");
		expect(md).not.toContain("### New holes");
	});
});

describe("sarif / junit", () => {
	const findings = [
		finding({
			rule: "links/broken",
			route: "/",
			title: "Broken link",
			severity: "error",
			subject: "/dead",
			location: { file: "src/a.tsx", symbol: "A" },
		}),
		finding({
			rule: "seo/title",
			route: "/about",
			title: "Title too short",
			severity: "warn",
			location: { selector: "head > title" },
		}),
	];

	it("produces SARIF 2.1.0 with rules and locations", () => {
		const sarif = toSarif(report(findings)) as {
			version: string;
			runs: Array<{
				tool: { driver: { rules: Array<{ id: string }> } };
				results: Array<Record<string, unknown>>;
			}>;
		};
		expect(sarif.version).toBe("2.1.0");
		const run = sarif.runs[0]!;
		expect(run.tool.driver.rules.map((r) => r.id)).toEqual(["links/broken", "seo/title"]);
		expect(run.results).toHaveLength(2);
		expect(run.results[0]?.level).toBe("error");
		expect(run.results[1]?.level).toBe("warning");
		expect(JSON.stringify(run.results[0]?.locations)).toContain('"uri":"src/a.tsx"');
		expect((run.results[0]!.partialFingerprints as Record<string, string>)["gribble/v1"]).toMatch(
			/^[0-9a-f]{16}$/,
		);
	});

	it("produces JUnit with failures for error/critical only", () => {
		const xml = toJUnit(report(findings));
		expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
		expect(xml).toContain('<testsuite name="links/broken" tests="1" failures="1"');
		expect(xml).toContain('<testsuite name="seo/title" tests="1" failures="0"');
		expect(xml.match(/<failure /g)).toHaveLength(1);
		expect(xml).toContain("&gt; title");
		expect(toJUnit(report([]))).toContain('name="no holes found"');
	});

	it("produces GitLab Code Quality issues with the finding fingerprint and a path", () => {
		const issues = toCodeQuality(report(findings));
		expect(issues).toHaveLength(2);
		expect(issues[0]).toMatchObject({
			type: "issue",
			check_name: "links/broken",
			description: "Broken link (/)",
			severity: "major",
			categories: ["links"],
			location: { path: "src/a.tsx", lines: { begin: 1 } },
		});
		expect(issues[0]?.fingerprint).toBe(findings[0]?.fingerprint);
		expect(issues[0]?.content.body).toContain("Subject: /dead");
		expect(issues[1]).toMatchObject({
			severity: "minor",
			description: "Title too short",
			location: { path: "/about", lines: { begin: 1 } },
		});
		expect(issues[1]?.content.body).toContain("Selector: head > title");
	});

	it("maps every severity and drops fixed findings from Code Quality", () => {
		const issues = toCodeQuality(
			report([
				finding({ rule: "flows/replay", route: "/", title: "c", severity: "critical" }),
				finding({ rule: "seo/title", route: "/", title: "i", severity: "info" }),
				finding({ rule: "seo/title", route: "/x", title: "gone", severity: "error", status: "fixed" }),
			]),
		);
		expect(issues.map((i) => i.severity)).toEqual(["critical", "info"]);
		expect(toCodeQuality(report([]))).toEqual([]);
	});
});

describe("report schema + writeRunReport", () => {
	it("validates the helper report and exports $id", () => {
		expect(
			Value.Check(reportSchema, report([finding({ rule: "links/broken", route: "/", title: "x" })])),
		).toBe(true);
		expect((reportJsonSchema() as { $id: string }).$id).toBe("https://gribble.dev/schema/report.json");
	});

	it("accepts the optional notRun list and rejects malformed entries", () => {
		const withNotRun = report([], {
			notRun: [
				{ rule: "perf/*", route: "/", reason: "Lighthouse could not run: no CDP port" },
				{ rule: "site/*", reason: "failed: boom" },
			],
		});
		expect(Value.Check(reportSchema, withNotRun)).toBe(true);
		expect(Value.Check(reportSchema, report([], { notRun: [{ rule: "perf/*" }] } as never))).toBe(false);
	});

	it("writes runs/<timestamp>/report.json, latest.json and prunes", async () => {
		await withTempDir(async (dir) => {
			const stamps = ["2026-09-01T00:00:00.000Z", "2026-09-02T00:00:00.000Z", "2026-09-03T00:00:00.000Z"];
			let result: Awaited<ReturnType<typeof writeRunReport>> | undefined;
			for (const generatedAt of stamps)
				result = await writeRunReport(dir, report([], { generatedAt }), { keep: 2 });
			expect(result?.dir).toBe(join(dir, "runs", "2026-09-03T00-00-00-000Z"));
			const latest = JSON.parse(await readFile(join(dir, "runs", "latest.json"), "utf8")) as {
				generatedAt: string;
			};
			expect(latest.generatedAt).toBe("2026-09-03T00:00:00.000Z");
			const entries = (await readdir(join(dir, "runs"))).sort();
			expect(entries).toEqual(["2026-09-02T00-00-00-000Z", "2026-09-03T00-00-00-000Z", "latest.json"]);
		});
	});
});
