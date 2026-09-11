import { describe, expect, it } from "vitest";
import {
	type AuditEvent,
	buildFinding,
	computeFingerprint,
	findFuzzyDuplicate,
	REPORT_TOOLS,
	REVIEW_RULE_IDS,
	reportPack,
} from "../src/index.js";
import { fakePi, fakeProject, fakeState, withTempDir } from "./agent-helpers.js";

const base = {
	rule: "review/ux",
	route: "/Pricing/",
	title: "The upgrade button does nothing",
	severity: "warn",
	confidence: 0.9,
	message: "Clicking Upgrade on the Pro card shows no feedback.",
} as const;

describe("buildFinding", () => {
	it("normalizes the route and computes the fingerprint in code", async () => {
		const state = fakeState();
		const finding = await buildFinding(state, { ...base, subject: "Upgrade button" });
		expect(finding.route).toBe("/pricing");
		expect(finding.source).toBe("ai");
		expect(finding.status).toBe("new");
		expect(finding.docsUrl).toBe("https://gribble.dev/rules/review/ux");
		expect(finding.viewport).toBe("desktop");
		expect(finding.fingerprint).toBe(
			computeFingerprint({ rule: "review/ux", targetName: "", route: "/pricing", subject: "Upgrade button" }),
		);
		const again = await buildFinding(state, { ...base, route: "/pricing?utm=1", subject: "Upgrade button" });
		expect(again.fingerprint).toBe(finding.fingerprint);
	});

	it("uses the title as subject when none is given and keeps explicit file locations", async () => {
		const state = fakeState();
		const finding = await buildFinding(state, {
			...base,
			location: { file: "src/Pricing.tsx", symbol: "UpgradeButton" },
		});
		expect(finding.location).toEqual({ file: "src/Pricing.tsx", symbol: "UpgradeButton" });
		expect(finding.fingerprint).toBe(
			computeFingerprint({
				rule: "review/ux",
				route: "/pricing",
				location: { file: "src/Pricing.tsx", symbol: "UpgradeButton" },
				subject: base.title,
			}),
		);
	});

	it("falls back to a stable selector when no source matches", async () => {
		await withTempDir(async (dir) => {
			const state = fakeState({ project: fakeProject({ dir }) });
			const finding = await buildFinding(state, { ...base, element: { testId: "upgrade-pro" } });
			expect(finding.location).toEqual({ selector: '[data-testid="upgrade-pro"]' });
		});
	});

	it("rejects non-review rules and out-of-range confidence", async () => {
		const state = fakeState();
		await expect(buildFinding(state, { ...base, rule: "links/broken" })).rejects.toThrow(/review\//);
		await expect(buildFinding(state, { ...base, rule: "review/nope" })).rejects.toThrow(/rule must be/);
		await expect(buildFinding(state, { ...base, confidence: 1.5 })).rejects.toThrow(/confidence/);
		expect(REVIEW_RULE_IDS).toContain("review/guidelines");
	});
});

describe("add_finding / finalize_report tools", () => {
	it("stores findings, emits events, and rejects exact and fuzzy duplicates", async () => {
		const events: AuditEvent[] = [];
		const state = fakeState({ events });
		const h = fakePi();
		await h.load(reportPack(state));

		const first = await h.call<{ finding: { fingerprint: string } }>(REPORT_TOOLS.addFinding, {
			...base,
			subject: "Upgrade",
		});
		expect(first.content[0]?.text).toMatch(/^Recorded [0-9a-f]{16}: warn review\/ux \/pricing/);
		expect(state.findings).toHaveLength(1);
		expect(events.filter((e) => e.type === "finding")).toHaveLength(1);

		const exact = await h.call<{ duplicate?: string }>(REPORT_TOOLS.addFinding, {
			...base,
			subject: "Upgrade",
		});
		expect(exact.details.duplicate).toBe(first.details.finding.fingerprint);

		const fuzzy = await h.call<{ duplicate?: string }>(REPORT_TOOLS.addFinding, {
			...base,
			title: "The upgrade button does nothing.",
			subject: "Pro card upgrade",
		});
		expect(fuzzy.details.duplicate).toBe(first.details.finding.fingerprint);
		expect(state.findings).toHaveLength(1);

		const other = await h.call(REPORT_TOOLS.addFinding, {
			...base,
			rule: "review/copy",
			title: "Typo in the hero",
			subject: "hero",
		});
		expect(other.details).toMatchObject({ finding: { rule: "review/copy" } });
		expect(state.findings).toHaveLength(2);

		const done = await h.call<{ summary: string }>(REPORT_TOOLS.finalizeReport, {
			summary: "Checked pricing. Two issues.",
		});
		expect(done.terminate).toBe(true);
		expect(state.finalized).toBe(true);
		expect(state.summary).toBe("Checked pricing. Two issues.");
	});

	it("findFuzzyDuplicate only matches AI findings on the same route and rule", () => {
		const a = { source: "ai", rule: "review/ux", route: "/a", title: "Button does nothing" };
		const list = [a] as never;
		expect(findFuzzyDuplicate(list, { route: "/a", rule: "review/ux", title: "Button does nothing!" })).toBe(
			a,
		);
		expect(
			findFuzzyDuplicate(list, { route: "/b", rule: "review/ux", title: "Button does nothing!" }),
		).toBeUndefined();
		expect(
			findFuzzyDuplicate(list, { route: "/a", rule: "review/copy", title: "Button does nothing!" }),
		).toBeUndefined();
	});
});
