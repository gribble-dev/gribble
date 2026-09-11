import type { ConsoleMessage, Locator, Page, Request, Response } from "playwright";
import { collectSnapshot } from "./snapshot-script.js";
import type {
	AuditPage,
	ConsoleEntry,
	FailedRequest,
	GotoResult,
	InteractiveElement,
	PageSnapshot,
	RequestRecord,
	SnapshotOptions,
	ViewportSize,
} from "./types.js";
import { urlMatcher } from "./url-match.js";

export const REF_ATTRIBUTE = "data-gribble-ref";
export const DEFAULT_SNAPSHOT_MAX_CHARS = 40_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const STYLE_SAMPLE_LIMIT = 300;

function consoleLevel(type: string): ConsoleEntry["level"] {
	if (type === "error" || type === "assert") return "error";
	if (type === "warning" || type === "warn") return "warning";
	if (type === "info") return "info";
	return "log";
}

function lowerHeaders(headers: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
	return out;
}

/** Playwright page wrapper: tracks console output and requests, and produces `page_snapshot` data. */
export class PlaywrightAuditPage implements AuditPage {
	readonly raw: Page;
	readonly viewport: string;
	readonly viewportSize: ViewportSize;
	private consoleEntries: ConsoleEntry[] = [];
	private failed: FailedRequest[] = [];
	private requestLog: RequestRecord[] = [];
	private lastSnapshot = new Map<string, InteractiveElement>();
	private lastGoto: GotoResult | undefined;
	private readonly onClose: () => Promise<void>;

	constructor(opts: {
		page: Page;
		viewport: string;
		viewportSize: ViewportSize;
		onClose?: () => Promise<void>;
	}) {
		this.raw = opts.page;
		this.viewport = opts.viewport;
		this.viewportSize = opts.viewportSize;
		this.onClose = opts.onClose ?? (async () => {});
		this.attach();
	}

	private attach(): void {
		const page = this.raw;
		page.on("console", (msg: ConsoleMessage) => {
			const entry: ConsoleEntry = { level: consoleLevel(msg.type()), text: msg.text() };
			const location = msg.location();
			if (location?.url) entry.url = location.url;
			this.consoleEntries.push(entry);
		});
		page.on("pageerror", (err: Error) => {
			this.consoleEntries.push({ level: "error", text: `Uncaught ${err.name}: ${err.message}` });
		});
		page.on("request", (req: Request) => {
			this.requestLog.push({ url: req.url(), method: req.method(), resourceType: req.resourceType() });
		});
		page.on("requestfailed", (req: Request) => {
			this.failed.push({
				url: req.url(),
				method: req.method(),
				failure: req.failure()?.errorText ?? "request failed",
				resourceType: req.resourceType(),
			});
		});
		page.on("response", (res: Response) => {
			const req = res.request();
			const record = this.requestLog.find(
				(r) => r.url === req.url() && r.status === undefined && r.method === req.method(),
			);
			const status = res.status();
			const headers = lowerHeaders(res.headers());
			if (record) {
				record.status = status;
				record.headers = headers;
				const length = Number(headers["content-length"]);
				if (Number.isFinite(length) && length > 0) record.bytes = length;
			}
			if (status >= 400) {
				this.failed.push({ url: req.url(), method: req.method(), status, resourceType: req.resourceType() });
			}
			// Body sizes arrive after the response finished; best effort, never throws.
			void res
				.finished()
				.then(() => req.sizes())
				.then((sizes) => {
					if (record && sizes.responseBodySize >= 0) {
						record.bytes = Math.max(record.bytes ?? 0, sizes.responseBodySize + sizes.responseHeadersSize);
					}
				})
				.catch(() => {});
		});
	}

	url(): string {
		return this.raw.url();
	}

	lastNavigation(): GotoResult | undefined {
		return this.lastGoto;
	}

	async goto(
		url: string,
		opts: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeoutMs?: number } = {},
	): Promise<GotoResult> {
		this.consoleEntries = [];
		this.failed = [];
		this.requestLog = [];
		this.lastSnapshot.clear();
		const waitUntil = opts.waitUntil ?? "load";
		let result: GotoResult;
		try {
			const response = await this.raw.goto(url, { waitUntil, timeout: opts.timeoutMs ?? 30_000 });
			if (waitUntil === "load") {
				// Give SPAs a moment to settle without waiting for long-polling connections.
				await this.raw.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
			}
			result = {
				status: response?.status(),
				ok: response ? response.ok() : true,
				finalUrl: this.raw.url(),
				headers: response ? lowerHeaders(response.headers()) : undefined,
			};
		} catch (err) {
			result = { ok: false, finalUrl: this.raw.url(), error: (err as Error).message };
		}
		this.lastGoto = result;
		return result;
	}

	private locatorFor(target: string): Locator {
		const ref = target.match(/^ref=(e\d+)$/);
		if (ref) {
			const known = this.lastSnapshot.get(ref[1]!);
			const byAttr = this.raw.locator(`[${REF_ATTRIBUTE}="${ref[1]}"]`);
			if (!known) return byAttr;
			return byAttr.or(this.raw.locator(known.selector)).first();
		}
		return this.raw.locator(target);
	}

	async click(target: string, opts: { timeoutMs?: number } = {}): Promise<void> {
		await this.locatorFor(target)
			.first()
			.click({ timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS });
	}

	async fill(target: string, value: string): Promise<void> {
		await this.locatorFor(target).first().fill(value, { timeout: DEFAULT_TIMEOUT_MS });
	}

	async press(key: string): Promise<void> {
		await this.raw.keyboard.press(key);
	}

	async waitFor(opts: { selector?: string; url?: string; text?: string; timeoutMs?: number }): Promise<void> {
		const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		if (opts.selector) await this.locatorFor(opts.selector).first().waitFor({ state: "visible", timeout });
		if (opts.text) await this.raw.getByText(opts.text).first().waitFor({ state: "visible", timeout });
		if (opts.url) {
			const matches = urlMatcher(opts.url);
			await this.raw.waitForURL((u) => matches(u.toString()), { timeout });
		}
		if (!opts.selector && !opts.text && !opts.url) {
			await this.raw.waitForLoadState("load", { timeout });
		}
	}

	async snapshot(opts: SnapshotOptions = {}): Promise<PageSnapshot> {
		const includeDom = opts.includeDom ?? true;
		const scriptOptions = {
			maxChars: opts.maxChars ?? DEFAULT_SNAPSHOT_MAX_CHARS,
			includeDom,
			refAttribute: REF_ATTRIBUTE,
			tokens: opts.tokens,
			minFontPx: opts.minFontPx,
			minTouchPx: opts.minTouchPx,
			styleSampleLimit: STYLE_SAMPLE_LIMIT,
		};
		const [collected, aria, title] = await Promise.all([
			this.raw.evaluate(collectSnapshot, scriptOptions),
			this.raw
				.locator("body")
				.ariaSnapshot()
				.catch(() => ""),
			this.raw.title().catch(() => ""),
		]);
		this.lastSnapshot = new Map(collected.interactive.map((e) => [e.ref, e]));
		const transferBytes = this.requestLog.reduce((sum, r) => sum + (r.bytes ?? 0), 0);
		return {
			url: this.raw.url(),
			title,
			status: this.lastGoto?.status,
			aria: aria.trim(),
			dom: collected.dom,
			interactive: collected.interactive,
			layout: collected.layout,
			styles: collected.styles,
			console: [...this.consoleEntries],
			failedRequests: [...this.failed],
			metrics: {
				domNodes: collected.domNodes,
				requestCount: this.requestLog.length,
				transferKb: Math.round(transferBytes / 1024),
			},
		};
	}

	async text(selector?: string): Promise<string> {
		const locator = selector ? this.locatorFor(selector).first() : this.raw.locator("body");
		return (await locator.innerText({ timeout: DEFAULT_TIMEOUT_MS })).trim();
	}

	async screenshot(opts: { fullPage?: boolean; path?: string } = {}): Promise<Buffer> {
		return this.raw.screenshot({ fullPage: opts.fullPage ?? false, path: opts.path, type: "png" });
	}

	drainConsole(): ConsoleEntry[] {
		const out = this.consoleEntries;
		this.consoleEntries = [];
		return out;
	}

	drainFailedRequests(): FailedRequest[] {
		const out = this.failed;
		this.failed = [];
		return out;
	}

	requests(): RequestRecord[] {
		return [...this.requestLog];
	}

	async resolveRef(ref: string): Promise<InteractiveElement | undefined> {
		return this.lastSnapshot.get(ref.replace(/^ref=/, ""));
	}

	async close(): Promise<void> {
		await this.raw.close().catch(() => {});
		await this.onClose();
	}
}
