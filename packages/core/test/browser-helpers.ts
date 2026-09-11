/**
 * Shared helpers for the browser, checks, gate and audit tests: a static server for the fixture
 * site, a ProjectContext factory and the chromium availability guard.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import type { ProjectContext } from "../src/index.js";
import { parseGribbleConfig, parseRulesConfig, resolveRules } from "../src/index.js";

export const FIXTURE_SITE = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", "site");

const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css",
	".xml": "application/xml",
	".txt": "text/plain",
	".png": "image/png",
	".js": "text/javascript",
};

export interface FixtureSite {
	url: string;
	port: number;
	server: Server;
	close(): Promise<void>;
}

/** Serve the fixture site on a random port. */
export async function startFixtureSite(): Promise<FixtureSite> {
	const server = createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		let path = url.pathname;
		if (path === "/") path = "/index.html";
		if (path === "/redirect-once") {
			res.writeHead(302, { location: "/about.html" });
			res.end();
			return;
		}
		if (path === "/redirect-twice") {
			res.writeHead(302, { location: "/redirect-once" });
			res.end();
			return;
		}
		const file = normalize(join(FIXTURE_SITE, path));
		if (!file.startsWith(FIXTURE_SITE)) {
			res.writeHead(403);
			res.end();
			return;
		}
		try {
			const body = await readFile(file);
			res.writeHead(200, {
				"content-type": TYPES[extname(file)] ?? "application/octet-stream",
				"content-length": body.length,
			});
			res.end(body);
		} catch {
			res.writeHead(404, { "content-type": "text/plain" });
			res.end("not found");
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	return {
		url: `http://127.0.0.1:${port}`,
		port,
		server,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

/** True when Playwright's chromium build is installed. */
export function hasChromium(): boolean {
	try {
		return existsSync(chromium.executablePath());
	} catch {
		return false;
	}
}

export const SKIP_BROWSER_REASON =
	"Playwright chromium is not installed; run `pnpm exec playwright install chromium`.";

export interface MakeProjectOptions {
	url: string;
	targetDir: string;
	/** rules.yaml text; defaults to the recommended preset. */
	rulesYaml?: string;
	/** Extra gribble.yaml lines under the top level. */
	gribbleYamlExtra?: string;
	start?: string;
	routes?: string[];
	flows?: ProjectContext["flows"];
	environment?: string;
}

/** Build a ProjectContext for tests, writing `.gribble/gribble.yaml` and `rules.yaml` into `targetDir`. */
export async function makeProject(opts: MakeProjectOptions): Promise<ProjectContext> {
	const gribbleDir = join(opts.targetDir, ".gribble");
	await mkdir(gribbleDir, { recursive: true });
	const routes = opts.routes ? `  routes: [${opts.routes.map((r) => JSON.stringify(r)).join(", ")}]\n` : "";
	const start = opts.start ? `  start: ${JSON.stringify(opts.start)}\n` : "";
	const gribbleYaml = `target:\n  url: ${opts.url}\n${routes}${start}${opts.gribbleYamlExtra ?? ""}`;
	const rulesYaml = opts.rulesYaml ?? "extends: [gribble:recommended]\n";
	await writeFile(join(gribbleDir, "gribble.yaml"), gribbleYaml, "utf8");
	await writeFile(join(gribbleDir, "rules.yaml"), rulesYaml, "utf8");
	const config = parseGribbleConfig(gribbleYaml, { environment: opts.environment });
	return {
		repoRoot: opts.targetDir,
		targetDir: opts.targetDir,
		gribbleDir,
		targetName: "",
		config,
		rules: resolveRules([parseRulesConfig(rulesYaml)]),
		guidelines: "",
		flows: opts.flows ?? [],
		environment: opts.environment,
		cascade: [gribbleDir],
	};
}
