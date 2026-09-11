/**
 * URL pattern matching shared by `waitFor({ url })`, flow replay `expect_url` and the auth probe.
 * Accepts `/regex/flags`, absolute URLs, path globs (`/blog/*`, `**\/dashboard`) and plain paths.
 */

function globToRegexSource(glob: string): string {
	let out = "";
	for (let i = 0; i < glob.length; i++) {
		const ch = glob[i]!;
		if (ch === "*") {
			if (glob[i + 1] === "*") {
				out += ".*";
				i += 1;
			} else {
				out += "[^/?#]*";
			}
		} else if (ch === "?") {
			out += "[^/?#]";
		} else {
			out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
		}
	}
	return out;
}

/** Build a predicate for a URL pattern. */
export function urlMatcher(pattern: string): (url: string) => boolean {
	const trimmed = pattern.trim();
	const regexLiteral = trimmed.match(/^\/(.+)\/([a-z]*)$/);
	if (regexLiteral && /[\\^$|()[\]+]/.test(regexLiteral[1]!)) {
		const re = new RegExp(regexLiteral[1]!, regexLiteral[2]);
		return (url) => re.test(url);
	}
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
		const re = new RegExp(`^${globToRegexSource(trimmed)}/?(?:[?#].*)?$`, "i");
		return (url) => re.test(url);
	}
	// A path (optionally with globs) matched against pathname (+ search when the pattern has one).
	const hasQuery = trimmed.includes("?");
	const re = new RegExp(
		`^${globToRegexSource(trimmed.startsWith("/") ? trimmed : `/${trimmed}`)}/?${hasQuery ? "" : "(?:\\?.*)?"}(?:#.*)?$`,
		"i",
	);
	return (url) => {
		try {
			const parsed = new URL(url);
			return re.test(hasQuery ? `${parsed.pathname}${parsed.search}` : parsed.pathname) || re.test(url);
		} catch {
			return re.test(url);
		}
	};
}
