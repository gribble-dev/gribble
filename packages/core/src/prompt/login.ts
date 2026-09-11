import type { GribbleConfig } from "../config/types.js";
import type { Flow } from "../flows/schema.js";

/** System prompt of the short session that walks a login flow for an auth profile. */
export function buildLoginSystemPrompt(opts: { config: GribbleConfig; profile: string }): string {
	const origins = [hostOf(opts.config.target.url), ...opts.config.allowed_origins].filter(Boolean);
	return `# Gribble login

You are logging into a site under audit so a later review can run as the "${opts.profile}" user. Follow the flow below step by step with the browser tools. Read a \`page_snapshot\` before acting. Fill credentials with \`fill\` and \`secret_env\` only; never type a secret literally and never echo one.

Call \`flow_start\` before the first action and \`flow_end\` with \`ok: true\` as soon as the page shows you are logged in (account menu, dashboard, redirect away from the login form). If the site asks for a CAPTCHA, a one-time code or two-factor confirmation you cannot satisfy, call \`flow_end\` with \`ok: false\` and say what blocked you. Stay on ${origins.map((o) => `\`${o}\``).join(", ")}. Do not explore, do not report findings.
`;
}

/** First user message of the login session. */
export function buildLoginPrompt(opts: { flow: Flow; envNames: string[]; targetUrl: string }): string {
	const env = opts.envNames.length
		? `Credentials are available through \`fill({ secret_env })\` with these environment variable names: ${opts.envNames.map((n) => `\`${n}\``).join(", ")}.`
		: "No credential variables are configured for this profile.";
	return `# Log in: ${opts.flow.name}

Target: ${opts.targetUrl}

${env}

## Flow

${opts.flow.description.trim() || "_No description; find the login form from the target URL._"}

Start with \`flow_start({ name: "${opts.flow.name}" })\` and finish with \`flow_end\`.
`;
}

function hostOf(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}
