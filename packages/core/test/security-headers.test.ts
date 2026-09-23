import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEvent, AuditPage, CheckContext, GotoResult, NotRunCheck } from "../src/index.js";
import {
	checkSecurity,
	HEADERS_LOOPBACK_REASON,
	LinkCache,
	META_CSP_NOTE,
	metaCspPolicy,
} from "../src/index.js";
import { makeProject } from "./browser-helpers.js";

const POLICY = "default-src 'self'; script-src 'self' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='";

const page = (head: string) =>
	`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">${head}<title>Fixture</title></head><body><main><h1>Fixture</h1></main></body></html>`;

describe("metaCspPolicy", () => {
	it("reads the policy from <meta http-equiv> whatever the case and quoting", () => {
		expect(metaCspPolicy(page(`<meta http-equiv="content-security-policy" content="${POLICY}">`))).toBe(
			POLICY,
		);
		expect(
			metaCspPolicy(page(`<META HTTP-EQUIV="Content-Security-Policy" CONTENT="default-src 'self'">`)),
		).toBe("default-src 'self'");
		expect(
			metaCspPolicy(page(`<meta content='default-src "self"' http-equiv='CONTENT-SECURITY-POLICY' />`)),
		).toBe('default-src "self"');
		expect(metaCspPolicy(page("<meta http-equiv=content-security-policy content=default-src>"))).toBe(
			"default-src",
		);
	});

	it("ignores report-only, empty policies and other meta tags", () => {
		expect(
			metaCspPolicy(page(`<meta http-equiv="content-security-policy-report-only" content="${POLICY}">`)),
		).toBe(undefined);
		expect(metaCspPolicy(page(`<meta http-equiv="content-security-policy" content="  ">`))).toBe(undefined);
		expect(metaCspPolicy(page(`<meta http-equiv="content-security-policy">`))).toBe(undefined);
		expect(metaCspPolicy(page(`<meta name="content-security-policy" content="${POLICY}">`))).toBe(undefined);
		expect(metaCspPolicy(page(""))).toBe(undefined);
	});
});

describe("security/headers", () => {
	let dir: string;

	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "gribble-headers-"));
	});

	afterAll(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	async function run(opts: {
		url?: string;
		headers: Record<string, string>;
		html: string;
		require?: string[];
		ctx?: Partial<CheckContext>;
	}) {
		const url = opts.url ?? "https://example.com";
		const require = opts.require ?? [
			"content-security-policy",
			"x-content-type-options",
			"strict-transport-security",
		];
		const project = await makeProject({
			url,
			targetDir: dir,
			rulesYaml: `rules:\n  security/headers: [error, { require: [${require.join(", ")}] }]\n`,
		});
		const navigation: GotoResult = { ok: true, status: 200, finalUrl: `${url}/`, headers: opts.headers };
		let contentReads = 0;
		const fake = {
			url: () => `${url}/`,
			lastNavigation: () => navigation,
			requests: () => [],
			raw: {
				content: async () => {
					contentReads++;
					return opts.html;
				},
			},
		} as unknown as AuditPage;
		const events: AuditEvent[] = [];
		const notRun: NotRunCheck[] = [];
		const ctx: CheckContext = {
			project,
			page: fake,
			route: "/",
			url: `${url}/`,
			viewport: "desktop",
			targetName: "",
			runDir: join(dir, "run"),
			shared: { links: new LinkCache(), reportedOnce: new Set() },
			onEvent: (e) => events.push(e),
			notRun,
			cache: { navigation },
			...opts.ctx,
		};
		const findings = await checkSecurity(ctx);
		return { findings, events, notRun, contentReads };
	}

	const HEADERS = {
		"content-type": "text/html",
		"x-content-type-options": "nosniff",
		"strict-transport-security": "max-age=63072000",
	};

	it("accepts a CSP delivered as <meta http-equiv> and says what the meta form cannot do", async () => {
		const { findings, events } = await run({
			headers: HEADERS,
			html: page(`<meta http-equiv="Content-Security-Policy" content="${POLICY}">`),
		});
		expect(findings).toEqual([]);
		const logs = events.filter((e) => e.type === "log");
		expect(logs).toEqual([
			{
				type: "log",
				level: "info",
				message: `/ delivers its content-security-policy in <meta http-equiv>; security/headers accepts it. ${META_CSP_NOTE}`,
			},
		]);
		expect(META_CSP_NOTE).toContain("frame-ancestors, report-uri or sandbox");
	});

	it("says the meta note once per run", async () => {
		const reportedOnce = new Set<string>();
		const html = page(`<meta http-equiv="content-security-policy" content="${POLICY}">`);
		const shared = { links: new LinkCache(), reportedOnce };
		const first = await run({ headers: HEADERS, html, ctx: { shared } });
		const second = await run({ headers: HEADERS, html, ctx: { shared, route: "/about" } });
		expect(first.events.filter((e) => e.type === "log")).toHaveLength(1);
		expect(second.events.filter((e) => e.type === "log")).toHaveLength(0);
	});

	it("still reports a missing CSP when the document carries none", async () => {
		const { findings } = await run({ headers: HEADERS, html: page("") });
		expect(findings.map((f) => f.subject)).toEqual(["content-security-policy"]);
		expect(findings[0]?.evidence).toBeUndefined();
	});

	it("keeps the other headers header-only and notes the meta CSP on the finding", async () => {
		const { findings } = await run({
			headers: { "content-type": "text/html" },
			html: page(
				`<meta http-equiv="content-security-policy" content="${POLICY}"><meta http-equiv="x-content-type-options" content="nosniff">`,
			),
		});
		expect(findings).toHaveLength(1);
		expect(findings[0]?.subject).toBe("x-content-type-options,strict-transport-security");
		expect(findings[0]?.title).toBe(
			"Missing security headers: x-content-type-options, strict-transport-security",
		);
		expect(findings[0]?.evidence?.data).toEqual({ cspDelivery: "meta", note: META_CSP_NOTE });
		expect(findings[0]?.evidence?.snippet).toContain('<meta http-equiv="content-security-policy"');
	});

	it("prefers the response header and does not read the document when it is there", async () => {
		const { findings, events, contentReads } = await run({
			headers: { ...HEADERS, "content-security-policy": POLICY },
			html: page(`<meta http-equiv="content-security-policy" content="${POLICY}">`),
		});
		expect(findings).toEqual([]);
		expect(events.filter((e) => e.type === "log")).toEqual([]);
		expect(contentReads).toBe(0);
	});

	it("records the rule as not run on a loopback target instead of passing it silently", async () => {
		const { findings, notRun } = await run({ url: "http://127.0.0.1:8791", headers: {}, html: page("") });
		expect(findings).toEqual([]);
		expect(notRun).toEqual([
			{
				rule: "security/headers",
				route: "/",
				reason: HEADERS_LOOPBACK_REASON,
				code: "skipped",
				intentional: true,
			},
		]);
	});

	it("records nothing when the rule is off", async () => {
		const project = await makeProject({
			url: "http://127.0.0.1:8791",
			targetDir: dir,
			rulesYaml: "rules: {}\n",
		});
		const { notRun } = await run({
			url: "http://127.0.0.1:8791",
			headers: {},
			html: page(""),
			ctx: { project },
		});
		expect(notRun).toEqual([]);
	});
});
