import { createServer } from "node:net";
import { type Browser, type BrowserContext, type BrowserContextOptions, chromium } from "playwright";
import type { AuthProfile, Viewport } from "../config/types.js";
import type { Flow } from "../flows/schema.js";
import {
	AuthError,
	looksLikeLoginUrl,
	readAuthCache,
	runCommandProfile,
	type StorageState,
	staticProfileContextOptions,
	writeAuthCache,
} from "./auth.js";
import { PlaywrightAuditPage } from "./page.js";
import type { AuditPage, BrowserSession, LaunchBrowserOptions, ViewportSize } from "./types.js";

export const ANONYMOUS_PROFILE = "anonymous";
export const DEFAULT_VIEWPORT: ViewportSize = { width: 1366, height: 768 };

async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close(() => resolve(port));
		});
	});
}

/** True when chromium is installed for this Playwright version. */
export async function chromiumAvailable(): Promise<boolean> {
	try {
		const { existsSync } = await import("node:fs");
		return existsSync(chromium.executablePath());
	} catch {
		return false;
	}
}

class PlaywrightBrowserSession implements BrowserSession {
	readonly baseUrl: string;
	private readonly contexts = new Map<string, Promise<BrowserContext>>();
	private readonly pages = new Set<AuditPage>();

	constructor(
		private readonly browser: Browser,
		private readonly port: number,
		private readonly opts: LaunchBrowserOptions,
		private readonly env: NodeJS.ProcessEnv,
	) {
		this.baseUrl = opts.project.config.target.url;
	}

	private viewportSize(name: string): ViewportSize {
		const configured: Viewport | undefined = this.opts.project.config.viewports[name];
		if (configured) return { width: configured.width, height: configured.height };
		if (name === "mobile") return { width: 390, height: 844 };
		return DEFAULT_VIEWPORT;
	}

	private log(level: "debug" | "info" | "warn" | "error", message: string): void {
		this.opts.onLog?.(level, message);
	}

	private defaultViewportName(): string {
		const names = Object.keys(this.opts.project.config.viewports);
		return names.includes("desktop") ? "desktop" : (names[0] ?? "desktop");
	}

	async newPage(opts: { viewport?: string; authProfile?: string } = {}): Promise<AuditPage> {
		const viewport = opts.viewport ?? this.defaultViewportName();
		const size = this.viewportSize(viewport);
		const context = await this.contextFor(opts.authProfile ?? ANONYMOUS_PROFILE, size);
		const page = await context.newPage();
		await page.setViewportSize(size);
		const audit = new PlaywrightAuditPage({
			page,
			viewport,
			viewportSize: size,
			onClose: async () => {
				this.pages.delete(audit);
			},
		});
		this.pages.add(audit);
		return audit;
	}

	private contextFor(profile: string, size: ViewportSize): Promise<BrowserContext> {
		let pending = this.contexts.get(profile);
		if (!pending) {
			pending = this.createContext(profile, size);
			this.contexts.set(profile, pending);
			pending.catch(() => this.contexts.delete(profile));
		}
		return pending;
	}

	private baseContextOptions(size: ViewportSize): BrowserContextOptions {
		return {
			viewport: size,
			ignoreHTTPSErrors: true,
			locale: "en-US",
			deviceScaleFactor: 1,
			serviceWorkers: "block",
		};
	}

	private async createContext(profile: string, size: ViewportSize): Promise<BrowserContext> {
		const base = this.baseContextOptions(size);
		if (profile === ANONYMOUS_PROFILE) return this.browser.newContext(base);
		const definition: AuthProfile | undefined = this.opts.project.config.auth?.profiles[profile];
		if (!definition) {
			throw new AuthError(`auth profile "${profile}" is not defined in gribble.yaml.`, profile);
		}
		if (definition.type === "cookie" || definition.type === "header") {
			return this.browser.newContext({
				...base,
				...staticProfileContextOptions(profile, definition, this.env, this.baseUrl),
			});
		}
		const cached = await readAuthCache(this.opts.project.gribbleDir, profile);
		if (cached) {
			const context = await this.browser.newContext({ ...base, storageState: cached.storageState });
			if (await this.probeLoggedIn(context)) {
				this.log("debug", `auth profile "${profile}": reusing cached session.`);
				return context;
			}
			this.log("info", `auth profile "${profile}": cached session expired, logging in again.`);
			await context.close();
		}
		if (definition.type === "command") {
			const state = await runCommandProfile(profile, definition.command, {
				cwd: this.opts.project.targetDir,
				env: this.env,
			});
			await writeAuthCache(this.opts.project.gribbleDir, profile, state);
			return this.browser.newContext({ ...base, storageState: state });
		}
		return this.loginWithFlow(profile, definition.flow, base);
	}

	private async loginWithFlow(
		profile: string,
		flowPath: string,
		base: BrowserContextOptions,
	): Promise<BrowserContext> {
		const runner = this.opts.authFlowRunner;
		if (!runner) {
			throw new AuthError(
				`auth profile "${profile}" is a flow, which needs the reviewer model. Run in review or all mode, or use a cookie/header/command profile for gate runs.`,
				profile,
			);
		}
		const flow = this.findFlow(flowPath);
		if (!flow) {
			throw new AuthError(
				`auth profile "${profile}": flow file ${flowPath} was not found under .gribble/.`,
				profile,
			);
		}
		const context = await this.browser.newContext(base);
		const page = await context.newPage();
		const audit = new PlaywrightAuditPage({
			page,
			viewport: this.defaultViewportName(),
			viewportSize: this.viewportSize(this.defaultViewportName()),
		});
		let ok = false;
		try {
			ok = await runner({ profile, flow, page: audit });
		} finally {
			await page.close().catch(() => {});
		}
		if (!ok) {
			await context.close();
			throw new AuthError(`auth profile "${profile}": the login flow did not complete.`, profile);
		}
		const state = (await context.storageState()) as StorageState;
		await writeAuthCache(this.opts.project.gribbleDir, profile, state);
		return context;
	}

	private findFlow(flowPath: string): Flow | undefined {
		const normalized = flowPath.replace(/\\/g, "/").replace(/^\.?\//, "");
		const base = normalized.replace(/^flows\//, "").replace(/\.md$/i, "");
		return this.opts.project.flows.find((f) => {
			const file = f.file.replace(/\\/g, "/");
			return file.endsWith(`/${normalized}`) || file.endsWith(`/${base}.md`) || f.name === base;
		});
	}

	private async probeLoggedIn(context: BrowserContext): Promise<boolean> {
		const page = await context.newPage();
		try {
			const response = await page.goto(this.baseUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
			if (response && response.status() >= 400) return false;
			return !looksLikeLoginUrl(page.url());
		} catch {
			return false;
		} finally {
			await page.close().catch(() => {});
		}
	}

	async cdpEndpoint(): Promise<string> {
		return `http://127.0.0.1:${this.port}`;
	}

	cdpPort(): number {
		return this.port;
	}

	async close(): Promise<void> {
		for (const page of [...this.pages]) await page.close().catch(() => {});
		for (const pending of this.contexts.values()) {
			await pending.then((ctx) => ctx.close()).catch(() => {});
		}
		this.contexts.clear();
		await this.browser.close().catch(() => {});
	}
}

/** Launch chromium with a remote debugging port (for Lighthouse) and return the session. */
export async function launchBrowser(opts: LaunchBrowserOptions): Promise<BrowserSession> {
	const port = await freePort();
	const browser = await chromium.launch({
		headless: opts.headless ?? true,
		args: [`--remote-debugging-port=${port}`, "--remote-allow-origins=*"],
	});
	return new PlaywrightBrowserSession(browser, port, opts, opts.env ?? process.env);
}
