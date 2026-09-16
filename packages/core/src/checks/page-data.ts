/**
 * Lazily cached page data shared by the per-route checks.
 */
import type { PageSnapshot } from "../browser/types.js";
import type { CheckContext } from "./types.js";

function cache(ctx: CheckContext): NonNullable<CheckContext["cache"]> {
	if (!ctx.cache) ctx.cache = {};
	return ctx.cache;
}

/** HTML media types; everything else is a document the page rules cannot judge. */
const HTML_MEDIA_TYPES = new Set(["text/html", "application/xhtml+xml"]);

/** `text/html; charset=utf-8` -> `text/html`. Undefined when the header is missing or empty. */
export function mediaTypeOf(contentType: string | undefined): string | undefined {
	const type = contentType?.split(";")[0]?.trim().toLowerCase();
	return type || undefined;
}

/**
 * True when the document response is HTML. A missing content-type header counts as HTML so a
 * server that forgets the header keeps the existing behaviour.
 */
export function isHtmlMediaType(contentType: string | undefined): boolean {
	const type = mediaTypeOf(contentType);
	return type === undefined || HTML_MEDIA_TYPES.has(type);
}

/** Media type of the navigation response, from the cached navigation or the page's last one. */
export function documentMediaType(ctx: CheckContext): string | undefined {
	return mediaTypeOf(
		ctx.cache?.navigation?.headers?.["content-type"] ?? ctx.page.lastNavigation()?.headers?.["content-type"],
	);
}

export async function getSnapshot(ctx: CheckContext): Promise<PageSnapshot> {
	const c = cache(ctx);
	if (!c.snapshot) c.snapshot = await ctx.page.snapshot({ includeDom: false });
	return c.snapshot;
}

export function setSnapshot(ctx: CheckContext, snapshot: PageSnapshot): void {
	cache(ctx).snapshot = snapshot;
}

export async function getHtml(ctx: CheckContext): Promise<string> {
	const c = cache(ctx);
	if (c.html === undefined) c.html = await ctx.page.raw.content().catch(() => "");
	return c.html;
}

export async function getBodyText(ctx: CheckContext): Promise<string> {
	const c = cache(ctx);
	if (c.text === undefined) c.text = await ctx.page.text().catch(() => "");
	return c.text;
}

/** Origin of the audited target, e.g. `http://localhost:3000`. */
export function targetOrigin(ctx: Pick<CheckContext, "project">): string {
	try {
		return new URL(ctx.project.config.target.url).origin;
	} catch {
		return "";
	}
}

export function sameOrigin(url: string, origin: string): boolean {
	try {
		return new URL(url).origin === origin;
	} catch {
		return false;
	}
}

export function isLoopbackHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
	return (
		host === "localhost" ||
		host === "127.0.0.1" ||
		host === "::1" ||
		host === "0.0.0.0" ||
		host.endsWith(".localhost")
	);
}
