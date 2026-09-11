/**
 * security/* — transport, mixed content, leaked credentials, response headers, exposed source maps.
 */
import type { Finding } from "../report/schema.js";
import { report, ruleEnabled, ruleOptions, truncate } from "./finding.js";
import { getHtml, isLoopbackHost, sameOrigin, targetOrigin } from "./page-data.js";
import type { CheckContext } from "./types.js";

interface SecretPattern {
	name: string;
	re: RegExp;
}

/** Credential shapes that never belong in shipped HTML or JavaScript. */
export const SECRET_PATTERNS: SecretPattern[] = [
	{ name: "AWS access key", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
	{ name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
	{ name: "Stripe live secret key", re: /\b(sk|rk)_live_[0-9A-Za-z]{20,}\b/g },
	{ name: "GitHub token", re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g },
	{ name: "GitHub fine-grained token", re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g },
	{ name: "Slack token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
	{ name: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
	{ name: "OpenAI API key", re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/g },
	{ name: "Twilio API key", re: /\bSK[0-9a-fA-F]{32}\b/g },
	{ name: "SendGrid API key", re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g },
	{ name: "private key block", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
	{
		name: "Supabase service role key",
		re: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b(?=[\s\S]{0,200}service_role)/g,
	},
];

export function maskSecret(value: string): string {
	if (value.length <= 10) return `${value.slice(0, 3)}…`;
	return `${value.slice(0, 6)}…${value.slice(-3)}`;
}

/** security/https-only, security/mixed-content, security/exposed-secrets, security/headers, security/sourcemaps-exposed. */
export async function checkSecurity(ctx: CheckContext): Promise<Finding[]> {
	const out: Finding[] = [];
	const rules = [
		"security/https-only",
		"security/mixed-content",
		"security/exposed-secrets",
		"security/headers",
		"security/sourcemaps-exposed",
	];
	if (!rules.some((r) => ruleEnabled(ctx, r))) return out;

	const target = new URL(ctx.project.config.target.url);
	const loopback = isLoopbackHost(target.hostname);
	const once = (key: string): boolean => {
		if (!ctx.shared) return true;
		if (ctx.shared.reportedOnce.has(key)) return false;
		ctx.shared.reportedOnce.add(key);
		return true;
	};

	if (
		ruleEnabled(ctx, "security/https-only") &&
		target.protocol === "http:" &&
		!loopback &&
		once("security/https-only")
	) {
		report(ctx, out, "security/https-only", {
			title: `${target.host} is served over plain HTTP`,
			message: `The target ${target.origin} is not local and does not use HTTPS.`,
			subject: target.origin,
			viewport: null,
		});
	}

	if (ruleEnabled(ctx, "security/mixed-content") && ctx.page.url().startsWith("https://")) {
		const seen = new Set<string>();
		for (const r of ctx.page.requests()) {
			if (!r.url.startsWith("http://")) continue;
			const key = r.url.split("?")[0]!;
			if (seen.has(key)) continue;
			seen.add(key);
			report(ctx, out, "security/mixed-content", {
				title: `HTTPS page loads ${r.resourceType ?? "resource"} over HTTP: ${truncate(key, 60)}`,
				message: `${ctx.url} requests ${r.url} without TLS; browsers block or downgrade mixed content.`,
				subject: key,
				evidence: { url: r.url },
			});
		}
	}

	if (ruleEnabled(ctx, "security/exposed-secrets")) {
		const html = await getHtml(ctx);
		const seen = new Set<string>();
		for (const { name, re } of SECRET_PATTERNS) {
			re.lastIndex = 0;
			for (const m of html.matchAll(re)) {
				const value = m[0];
				const masked = maskSecret(value);
				if (seen.has(masked)) continue;
				seen.add(masked);
				const start = Math.max(0, (m.index ?? 0) - 40);
				const snippet = html
					.slice(start, (m.index ?? 0) + value.length + 20)
					.replace(value, masked)
					.replace(/\s+/g, " ");
				report(ctx, out, "security/exposed-secrets", {
					title: `${name} found in the page source (${masked})`,
					message: `A value shaped like a ${name} is embedded in the HTML or inline JavaScript of ${ctx.route}. Anyone loading the page can read it.`,
					subject: masked,
					location: { path: "document" },
					evidence: { snippet },
				});
				if (seen.size >= 10) break;
			}
		}
	}

	if (ruleEnabled(ctx, "security/headers")) {
		const required = (ruleOptions<{ require: string[] }>(ctx, "security/headers").require ?? []).map((h) =>
			h.toLowerCase(),
		);
		const headers = ctx.cache?.navigation?.headers ?? ctx.page.lastNavigation()?.headers ?? {};
		const missing = required.filter(
			(h) => !(h in headers) && !(h === "strict-transport-security" && ctx.page.url().startsWith("http://")),
		);
		if (missing.length) {
			report(ctx, out, "security/headers", {
				title: `Missing security headers: ${missing.join(", ")}`,
				message: `The document response for ${ctx.route} lacks ${missing.join(", ")}.`,
				subject: missing.join(","),
				viewport: null,
			});
		}
	}

	if (ruleEnabled(ctx, "security/sourcemaps-exposed") && !loopback && ctx.shared) {
		const origin = targetOrigin(ctx);
		const scripts = ctx.page
			.requests()
			.filter((r) => r.resourceType === "script" && sameOrigin(r.url, origin) && /\.m?js(\?|$)/.test(r.url))
			.slice(0, 10);
		for (const script of scripts) {
			const mapUrl = `${script.url.split("?")[0]}.map`;
			if (!once(`sourcemap:${mapUrl}`)) continue;
			const probe = await ctx.shared.links.probe(mapUrl);
			if (probe.ok && (probe.headers?.["content-type"] ?? "").includes("json")) {
				report(ctx, out, "security/sourcemaps-exposed", {
					title: `Source map exposed: ${truncate(mapUrl, 70)}`,
					message: `${mapUrl} is publicly served, revealing the original source of ${script.url}.`,
					subject: mapUrl,
					evidence: { url: mapUrl },
					viewport: null,
				});
			}
		}
	}
	return out;
}
