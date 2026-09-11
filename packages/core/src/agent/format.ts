/**
 * Compact, model-facing rendering of a page snapshot. The structured data goes into
 * `details`; this text is what the model reads.
 */
import type { InteractiveElement, PageSnapshot } from "../browser/types.js";

export interface FormatSnapshotOptions {
	includeDom?: boolean;
	/** Cap for the whole text, default 40000 characters. */
	maxChars?: number;
	/** Cap for the interactive element list, default 150. */
	maxInteractive?: number;
}

export function formatInteractiveElement(el: InteractiveElement): string {
	const attrs: string[] = [];
	if (el.testId) attrs.push(`data-testid=${el.testId}`);
	else if (el.id) attrs.push(`#${el.id}`);
	if (el.href) attrs.push(`href=${el.href}`);
	if (el.disabled) attrs.push("disabled");
	const name = el.name ? ` "${truncate(el.name, 60)}"` : "";
	const attrText = attrs.length ? ` [${attrs.join(" ")}]` : "";
	return `${el.ref} ${el.role || el.tag}${name}${attrText}`;
}

export function formatSnapshot(snapshot: PageSnapshot, opts: FormatSnapshotOptions = {}): string {
	const maxChars = opts.maxChars ?? 40000;
	const maxInteractive = opts.maxInteractive ?? 150;
	const out: string[] = [];
	out.push(`# ${snapshot.title || "(no title)"}`);
	out.push(`url: ${snapshot.url}${snapshot.status !== undefined ? `  status: ${snapshot.status}` : ""}`);
	if (snapshot.metrics) {
		out.push(
			`dom nodes: ${snapshot.metrics.domNodes}  requests: ${snapshot.metrics.requestCount}  transfer: ${snapshot.metrics.transferKb} kB`,
		);
	}

	const aria = snapshot.aria.trim();
	if (aria) {
		out.push("", "## Accessibility tree", "", aria);
	}

	if (snapshot.interactive.length) {
		out.push("", `## Interactive elements (${snapshot.interactive.length})`, "");
		for (const el of snapshot.interactive.slice(0, maxInteractive)) out.push(formatInteractiveElement(el));
		if (snapshot.interactive.length > maxInteractive) {
			out.push(
				`... ${snapshot.interactive.length - maxInteractive} more; use extract_text or a narrower page`,
			);
		}
	}

	if (snapshot.layout.length) {
		out.push("", "## Layout issues (computed)", "");
		for (const issue of snapshot.layout)
			out.push(`- ${issue.kind} [${issue.refs.join(", ")}]: ${issue.detail}`);
	}

	if (snapshot.styles.length) {
		out.push("", "## Style values outside the design tokens", "");
		for (const v of snapshot.styles) {
			const expected = v.expected ? ` (expected ${v.expected})` : "";
			out.push(
				`- ${v.ref} ${v.selector}: ${v.property}=${v.value}${expected}${v.text ? ` "${truncate(v.text, 40)}"` : ""}`,
			);
		}
	}

	const errors = snapshot.console.filter((c) => c.level === "error" || c.level === "warning");
	if (errors.length) {
		out.push("", "## Console", "");
		for (const entry of errors.slice(0, 30)) out.push(`- [${entry.level}] ${truncate(entry.text, 300)}`);
	}

	if (snapshot.failedRequests.length) {
		out.push("", "## Failed requests", "");
		for (const req of snapshot.failedRequests.slice(0, 30)) {
			out.push(`- ${req.method} ${req.url} -> ${req.status ?? req.failure ?? "failed"}`);
		}
	}

	if (opts.includeDom || !aria) {
		const dom = snapshot.dom.trim();
		if (dom) out.push("", "## Simplified DOM", "", dom);
	}

	const text = out.join("\n");
	return text.length > maxChars
		? `${text.slice(0, maxChars)}\n\n[snapshot truncated at ${maxChars} characters]`
		: text;
}

export function truncate(text: string, max: number): string {
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}
