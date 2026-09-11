import { sha256 } from "../util/index.js";
import type { FindingLocation } from "./schema.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NUMERIC = /^\d+$/;

/**
 * Normalize a route for fingerprinting and baseline matching: lowercase, no query or hash,
 * no trailing slash, numeric and UUID segments replaced with `[id]`. Absolute URLs are reduced
 * to their path. Framework placeholders such as `[slug]` are kept as they are.
 */
export function normalizeRoute(route: string): string {
	let path = route.trim();
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
		try {
			path = new URL(path).pathname;
		} catch {
			// fall through and treat it as a path
		}
	}
	path = path.split(/[?#]/)[0] ?? "";
	path = path.toLowerCase().replace(/\/{2,}/g, "/");
	if (!path.startsWith("/")) path = `/${path}`;
	if (path.length > 1) path = path.replace(/\/+$/, "");
	const segments = path.split("/").map((seg) => (NUMERIC.test(seg) || UUID.test(seg) ? "[id]" : seg));
	return segments.join("/") || "/";
}

/** `file#symbol` > `file` > `selector` > `path` > "". */
export function locationKey(location?: FindingLocation): string {
	if (!location) return "";
	if (location.file) return location.symbol ? `${location.file}#${location.symbol}` : location.file;
	if (location.selector) return location.selector;
	if (location.path) return location.path;
	return "";
}

export interface FingerprintInput {
	rule: string;
	targetName?: string;
	route: string;
	location?: FindingLocation;
	subject?: string;
}

/** First 16 hex characters of sha256 over rule, target, normalized route, location key and subject. */
export function computeFingerprint(input: FingerprintInput): string {
	const material = [
		input.rule,
		input.targetName ?? "",
		normalizeRoute(input.route),
		locationKey(input.location),
		input.subject ?? "",
	].join("\n");
	return sha256(material).slice(0, 16);
}
