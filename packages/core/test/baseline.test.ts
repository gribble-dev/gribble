import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diffAgainstBaseline, readBaseline, routeSlug, writeBaseline } from "../src/index.js";
import { finding, report, withTempDir } from "./helpers.js";

describe("routeSlug", () => {
	it("matches the contract examples", () => {
		expect(routeSlug("/")).toBe("index");
		expect(routeSlug("/blog/[slug]")).toBe("blog__slug_");
		expect(routeSlug("/pricing")).toBe("pricing");
		expect(routeSlug("/a/b-c/")).toBe("a_b_c");
		expect(routeSlug("/users/[id]/settings")).toBe("users__id__settings");
	});
});

describe("baseline write / read / diff", () => {
	it("round-trips and preserves firstSeen", async () => {
		await withTempDir(async (dir) => {
			const a = finding({ rule: "links/broken", route: "/", title: "a", subject: "/a", severity: "error" });
			const b = finding({ rule: "seo/title", route: "/about", title: "b", severity: "warn" });
			const first = report([a, b], {
				repo: { commit: "c1", branch: "main" },
				routes: [{ route: "/", url: "http://l/", metrics: { lcpMs: 1200, cls: 0.01 } }],
				model: { provider: "p", id: "m" },
			});
			await writeBaseline(dir, {
				report: first,
				snapshots: { "/": "- banner:\n  - heading" },
				screenshots: { "/@mobile": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]) },
				viewports: { mobile: { width: 390, height: 844 } },
			});
			expect((await stat(join(dir, "baseline", "snapshots", "index.aria.yaml"))).isFile()).toBe(true);
			expect((await stat(join(dir, "baseline", "screenshots", "index@mobile.png"))).isFile()).toBe(true);

			const baseline = await readBaseline(dir);
			expect(baseline?.meta.commit).toBe("c1");
			expect(baseline?.meta.viewports.mobile?.width).toBe(390);
			expect(baseline?.metrics["/"]?.lcpMs).toBe(1200);
			expect(baseline?.findings.map((f) => f.fingerprint).sort()).toEqual(
				[a.fingerprint, b.fingerprint].sort(),
			);
			expect(baseline?.findings.find((f) => f.fingerprint === a.fingerprint)?.firstSeen).toEqual({
				commit: "c1",
				at: first.generatedAt,
			});

			const c = finding({ rule: "links/broken", route: "/", title: "c", subject: "/c", severity: "error" });
			const diff = diffAgainstBaseline([a, c], baseline);
			expect(diff.findings.map((f) => f.status)).toEqual(["existing", "new"]);
			expect(diff.fixed.map((f) => f.fingerprint)).toEqual([b.fingerprint]);
			expect(diff.existingCount).toBe(1);
			expect(diff.newCount).toBe(1);

			const second = report(diff.findings, {
				repo: { commit: "c2" },
				generatedAt: "2026-09-12T00:00:00.000Z",
			});
			await writeBaseline(dir, { report: second });
			const updated = await readBaseline(dir);
			expect(updated?.findings.find((f) => f.fingerprint === a.fingerprint)?.firstSeen.commit).toBe("c1");
			expect(updated?.findings.find((f) => f.fingerprint === c.fingerprint)?.firstSeen.commit).toBe("c2");
			expect(updated?.findings.some((f) => f.fingerprint === b.fingerprint)).toBe(false);
			expect(updated?.metrics["/"]?.lcpMs).toBe(1200);
			expect(JSON.parse(await readFile(join(dir, "baseline", "findings.json"), "utf8")).version).toBe(1);
		});
	});

	it("limits fixed to audited routes and keeps other routes on partial writes", async () => {
		await withTempDir(async (dir) => {
			const a = finding({ rule: "links/broken", route: "/", title: "a", subject: "/a" });
			const b = finding({ rule: "links/broken", route: "/about", title: "b", subject: "/b" });
			await writeBaseline(dir, { report: report([a, b]) });
			const baseline = await readBaseline(dir);
			const diff = diffAgainstBaseline([], baseline, { auditedRoutes: ["/about/"] });
			expect(diff.fixed.map((f) => f.route)).toEqual(["/about"]);
			await writeBaseline(dir, { report: report([]), auditedRoutes: ["/about"] });
			expect((await readBaseline(dir))?.findings.map((f) => f.route)).toEqual(["/"]);
		});
	});

	it("returns undefined without a baseline and marks everything new", async () => {
		await withTempDir(async (dir) => {
			expect(await readBaseline(dir)).toBeUndefined();
			const diff = diffAgainstBaseline(
				[finding({ rule: "links/broken", route: "/", title: "a" })],
				undefined,
			);
			expect(diff.findings[0]?.status).toBe("new");
			expect(diff.newCount).toBe(1);
		});
	});
});
