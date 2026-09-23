import { describe, expect, it } from "vitest";
import { judgeProbe } from "../src/checks/links.js";
import type { LinkProbe } from "../src/index.js";

const ORIGIN = "http://localhost:8790";
const IGNORE = ["linkedin.com"];

function probe(partial: Partial<LinkProbe>): LinkProbe {
	const url = partial.url ?? `${ORIGIN}/go/saily`;
	return { url, ok: false, redirects: 0, finalUrl: url, ...partial };
}

describe("judgeProbe", () => {
	it("keeps same-origin failures under links/broken, 403 included", () => {
		expect(judgeProbe(probe({ status: 404 }), { internal: true, origin: ORIGIN, ignore: IGNORE })).toEqual({
			rule: "links/broken",
			redirectedOff: false,
			broken: true,
		});
		expect(
			judgeProbe(probe({ status: 403 }), { internal: true, origin: ORIGIN, ignore: IGNORE }).broken,
		).toBe(true);
	});

	it("keeps same-origin redirects that stay on the site under links/broken", () => {
		const verdict = judgeProbe(probe({ status: 403, redirects: 1, finalUrl: `${ORIGIN}/login` }), {
			internal: true,
			origin: ORIGIN,
			ignore: IGNORE,
		});
		expect(verdict).toEqual({ rule: "links/broken", redirectedOff: false, broken: true });
	});

	it("treats a 403 at the end of an off-site redirect as inconclusive", () => {
		const verdict = judgeProbe(probe({ status: 403, redirects: 1, finalUrl: "https://saily.com/esim" }), {
			internal: true,
			origin: ORIGIN,
			ignore: IGNORE,
		});
		expect(verdict).toEqual({ rule: "links/broken-external", redirectedOff: true, broken: false });
		for (const status of [429, 999]) {
			expect(
				judgeProbe(probe({ status, redirects: 2, finalUrl: "https://saily.com/esim" }), {
					internal: true,
					origin: ORIGIN,
					ignore: IGNORE,
				}).broken,
			).toBe(false);
		}
	});

	it("reports other off-site redirect failures under links/broken-external", () => {
		expect(
			judgeProbe(probe({ status: 404, redirects: 1, finalUrl: "https://saily.com/gone" }), {
				internal: true,
				origin: ORIGIN,
				ignore: IGNORE,
			}),
		).toEqual({ rule: "links/broken-external", redirectedOff: true, broken: true });
		expect(
			judgeProbe(probe({ error: "timed out after 10000ms", redirects: 1, finalUrl: "https://saily.com/" }), {
				internal: true,
				origin: ORIGIN,
				ignore: IGNORE,
			}),
		).toEqual({ rule: "links/broken-external", redirectedOff: true, broken: true });
	});

	it("honours the links/broken-external ignore hosts for the redirect target", () => {
		const gone = probe({ status: 404, redirects: 1, finalUrl: "https://www.linkedin.com/company/x" });
		expect(judgeProbe(gone, { internal: true, origin: ORIGIN, ignore: ["*.linkedin.com"] }).broken).toBe(
			false,
		);
		const saily = probe({ status: 404, redirects: 1, finalUrl: "https://saily.com/esim" });
		expect(judgeProbe(saily, { internal: true, origin: ORIGIN, ignore: ["saily.com"] })).toEqual({
			rule: "links/broken-external",
			redirectedOff: true,
			broken: false,
		});
	});

	it("leaves direct external links as they were", () => {
		const external = { internal: false, origin: ORIGIN, ignore: IGNORE };
		const url = "https://saily.com/esim";
		expect(judgeProbe(probe({ url, finalUrl: url, status: 403 }), external)).toEqual({
			rule: "links/broken-external",
			redirectedOff: false,
			broken: false,
		});
		expect(judgeProbe(probe({ url, finalUrl: url, status: 500 }), external).broken).toBe(true);
		expect(judgeProbe(probe({ url, finalUrl: url, status: 200, ok: true }), external).broken).toBe(false);
	});
});
