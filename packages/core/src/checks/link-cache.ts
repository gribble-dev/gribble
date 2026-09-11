/**
 * HTTP probe with a per-run cache. HEAD first, GET on 405/501 or when HEAD errors, redirects followed
 * by hand so chain length is known. Never throws: failures are results.
 */

export interface LinkProbe {
	url: string;
	status?: number;
	ok: boolean;
	redirects: number;
	finalUrl: string;
	error?: string;
	headers?: Record<string, string>;
	/** Response body for GET probes when `wantBody` was set. */
	body?: string;
}

export interface LinkCacheOptions {
	timeoutMs?: number;
	concurrency?: number;
	extraHeaders?: Record<string, string>;
	userAgent?: string;
}

const MAX_REDIRECTS = 10;
const DEFAULT_UA = "Mozilla/5.0 (compatible; Gribble/0.1; +https://gribble.dev)";

export class LinkCache {
	private readonly cache = new Map<string, Promise<LinkProbe>>();
	private active = 0;
	private readonly queue: Array<() => void> = [];
	private readonly timeoutMs: number;
	private readonly concurrency: number;
	private readonly headers: Record<string, string>;

	constructor(opts: LinkCacheOptions = {}) {
		this.timeoutMs = opts.timeoutMs ?? 10_000;
		this.concurrency = opts.concurrency ?? 8;
		this.headers = {
			"user-agent": opts.userAgent ?? DEFAULT_UA,
			accept: "*/*",
			...(opts.extraHeaders ?? {}),
		};
	}

	/** Probe a URL, reusing an earlier result for the same URL and options. */
	probe(url: string, opts: { timeoutMs?: number; wantBody?: boolean } = {}): Promise<LinkProbe> {
		const key = `${opts.wantBody ? "GET " : ""}${url}`;
		let pending = this.cache.get(key);
		if (!pending) {
			pending = this.withSlot(() => this.run(url, opts));
			this.cache.set(key, pending);
		}
		return pending;
	}

	size(): number {
		return this.cache.size;
	}

	private withSlot<T>(fn: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const start = () => {
				this.active += 1;
				fn()
					.then(resolve, reject)
					.finally(() => {
						this.active -= 1;
						this.queue.shift()?.();
					});
			};
			if (this.active < this.concurrency) start();
			else this.queue.push(start);
		});
	}

	private async request(url: string, method: "HEAD" | "GET", timeoutMs: number): Promise<Response> {
		return fetch(url, {
			method,
			redirect: "manual",
			headers: this.headers,
			signal: AbortSignal.timeout(timeoutMs),
		});
	}

	private async run(url: string, opts: { timeoutMs?: number; wantBody?: boolean }): Promise<LinkProbe> {
		const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
		let current = url;
		let redirects = 0;
		let method: "HEAD" | "GET" = opts.wantBody ? "GET" : "HEAD";
		for (;;) {
			let response: Response;
			try {
				response = await this.request(current, method, timeoutMs);
			} catch (err) {
				if (method === "HEAD") {
					method = "GET";
					continue;
				}
				const message =
					(err as Error).name === "TimeoutError" ? `timed out after ${timeoutMs}ms` : (err as Error).message;
				return { url, ok: false, redirects, finalUrl: current, error: message };
			}
			const status = response.status;
			if (status >= 300 && status < 400) {
				const location = response.headers.get("location");
				await response.body?.cancel().catch(() => {});
				if (!location)
					return { url, status, ok: false, redirects, finalUrl: current, error: "redirect without location" };
				redirects += 1;
				if (redirects > MAX_REDIRECTS) {
					return { url, status, ok: false, redirects, finalUrl: current, error: "too many redirects" };
				}
				try {
					current = new URL(location, current).toString();
				} catch {
					return {
						url,
						status,
						ok: false,
						redirects,
						finalUrl: current,
						error: `invalid redirect target ${location}`,
					};
				}
				continue;
			}
			if (
				method === "HEAD" &&
				(status === 405 || status === 501 || status === 403 || status === 404 || status >= 500)
			) {
				await response.body?.cancel().catch(() => {});
				method = "GET";
				continue;
			}
			const headers: Record<string, string> = {};
			response.headers.forEach((v, k) => {
				headers[k] = v;
			});
			const probe: LinkProbe = { url, status, ok: status < 400, redirects, finalUrl: current, headers };
			if (opts.wantBody && method === "GET") {
				try {
					probe.body = await response.text();
				} catch {
					probe.body = "";
				}
			} else {
				await response.body?.cancel().catch(() => {});
			}
			return probe;
		}
	}
}
