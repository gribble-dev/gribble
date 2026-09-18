/**
 * a11y/* rules that axe-core does not cover: focus-visible, keyboard-reachable, skip-link and
 * reduced-motion. Each concern is one `page.evaluate`. focus-visible moves focus and reduced-motion
 * emulates a media feature; both put the page back the way they found it before returning.
 */
import type { Finding } from "../report/schema.js";
import { report, ruleEnabled, truncate } from "./finding.js";
import type { CheckContext } from "./types.js";

/** Interactive elements examined per route by focus-visible; the rest are ignored. */
const FOCUS_PROBE_LIMIT = 60;
/** Findings per rule and route. */
const MAX_FINDINGS = 10;
/** Tabbable elements before the main content that make a skip link worth having. */
const SKIP_LINK_MIN_LEADING = 5;
/** Animations and transitions shorter than this in total are not motion worth reducing. */
const MOTION_THRESHOLD_MS = 1000;
/** Elements scanned per route by reduced-motion. */
const MOTION_SCAN_LIMIT = 3000;

interface FocusProbe {
	examined: number;
	unstyled: Array<{ selector: string; tag: string; className: string; label: string }>;
}

/** Focus each interactive element and compare its computed style before and after. Runs in the page. */
function probeFocusStyles(input: { limit: number }): FocusProbe {
	const selectorFor = (el: Element): string => {
		const testId = el.getAttribute("data-testid");
		if (testId) return `[data-testid="${testId}"]`;
		const id = el.getAttribute("id");
		if (id) return `#${CSS.escape(id)}`;
		const parts: string[] = [];
		let node: Element | null = el;
		while (node && node.tagName.toLowerCase() !== "body" && parts.length < 6) {
			const parent: Element | null = node.parentElement;
			if (!parent) break;
			const same = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
			parts.unshift(
				same.length > 1
					? `${node.tagName.toLowerCase()}:nth-of-type(${same.indexOf(node) + 1})`
					: node.tagName.toLowerCase(),
			);
			node = parent;
		}
		return parts.join(" > ");
	};
	const isRendered = (el: Element): boolean => {
		const rect = el.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return false;
		const check = (el as Element & { checkVisibility?: (options?: unknown) => boolean }).checkVisibility;
		if (typeof check === "function") {
			return check.call(el, { contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true });
		}
		const style = getComputedStyle(el);
		return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
	};
	const labelOf = (el: Element): string => {
		const input = el as HTMLInputElement;
		const text =
			el.getAttribute("aria-label") ||
			(el.textContent ?? "").replace(/\s+/g, " ").trim() ||
			el.getAttribute("placeholder") ||
			el.getAttribute("title") ||
			(typeof input.value === "string" ? input.value : "") ||
			el.getAttribute("alt") ||
			"";
		return text.slice(0, 60);
	};
	const OWN = [
		"outline-style",
		"outline-width",
		"outline-color",
		"outline-offset",
		"box-shadow",
		"border-top-color",
		"border-right-color",
		"border-bottom-color",
		"border-left-color",
		"border-top-style",
		"border-bottom-style",
		"border-top-width",
		"border-bottom-width",
		"background-color",
		"background-image",
		"color",
		"text-decoration-line",
		"text-decoration-color",
		"filter",
		"transform",
		"opacity",
	];
	const PSEUDO = [
		"content",
		"outline-style",
		"outline-width",
		"box-shadow",
		"background-color",
		"border-top-color",
		"opacity",
		"transform",
		"width",
		"height",
	];
	const PARENT = ["outline-style", "outline-width", "box-shadow", "background-color", "border-top-color"];
	const read = (style: CSSStyleDeclaration, props: string[]): string =>
		props.map((p) => style.getPropertyValue(p)).join("|");
	const signature = (el: Element): string => {
		const parts = [
			read(getComputedStyle(el), OWN),
			read(getComputedStyle(el, "::before"), PSEUDO),
			read(getComputedStyle(el, "::after"), PSEUDO),
		];
		if (el.parentElement) parts.push(read(getComputedStyle(el.parentElement), PARENT));
		return parts.join("||");
	};

	const result: FocusProbe = { examined: 0, unstyled: [] };
	const previous = document.activeElement;
	const candidates = document.querySelectorAll(
		'a[href], button, input, select, textarea, summary, [tabindex], [role="button"], [role="link"]',
	);
	for (const el of Array.from(candidates)) {
		if (result.examined >= input.limit) break;
		if (!(el instanceof HTMLElement)) continue;
		if (el.getAttribute("tabindex") === "-1") continue;
		if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") continue;
		if (el instanceof HTMLInputElement && el.type === "hidden") continue;
		if (el.closest('[aria-hidden="true"], [inert]')) continue;
		if (!isRendered(el)) continue;
		const before = signature(el);
		el.focus({ preventScroll: true });
		if (document.activeElement !== el) continue;
		result.examined += 1;
		// When the browser itself would not paint a focus ring (it decided the focus is not
		// "visible"), the author's :focus-visible rules do not apply either; nothing to judge.
		const visible = el.matches(":focus-visible");
		const after = visible ? signature(el) : before;
		el.blur();
		if (visible && before === after) {
			result.unstyled.push({
				selector: selectorFor(el),
				tag: el.tagName.toLowerCase(),
				className: typeof el.className === "string" ? el.className.trim() : "",
				label: labelOf(el),
			});
		}
	}
	const active = document.activeElement;
	if (active instanceof HTMLElement && active !== document.body) active.blur();
	if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected) {
		previous.focus({ preventScroll: true });
	}
	return result;
}

interface KeyboardIssue {
	kind: "not-focusable" | "removed" | "positive-tabindex";
	selector: string;
	tag: string;
	label: string;
	detail: string;
}

/** Controls that a keyboard cannot reach. Runs in the page. */
function findKeyboardIssues(input: { limit: number }): KeyboardIssue[] {
	const selectorFor = (el: Element): string => {
		const testId = el.getAttribute("data-testid");
		if (testId) return `[data-testid="${testId}"]`;
		const id = el.getAttribute("id");
		if (id) return `#${CSS.escape(id)}`;
		const parts: string[] = [];
		let node: Element | null = el;
		while (node && node.tagName.toLowerCase() !== "body" && parts.length < 6) {
			const parent: Element | null = node.parentElement;
			if (!parent) break;
			const same = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
			parts.unshift(
				same.length > 1
					? `${node.tagName.toLowerCase()}:nth-of-type(${same.indexOf(node) + 1})`
					: node.tagName.toLowerCase(),
			);
			node = parent;
		}
		return parts.join(" > ");
	};
	const isRendered = (el: Element): boolean => {
		const rect = el.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return false;
		const check = (el as Element & { checkVisibility?: (options?: unknown) => boolean }).checkVisibility;
		if (typeof check === "function") {
			return check.call(el, { contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true });
		}
		const style = getComputedStyle(el);
		return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
	};
	const labelOf = (el: Element): string =>
		(el.getAttribute("aria-label") || (el.textContent ?? "").replace(/\s+/g, " ").trim() || "").slice(0, 60);
	const NATIVE =
		'a[href], area[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, audio[controls], video[controls], [contenteditable=""], [contenteditable="true"]';
	const COMPOSITE =
		'[role="toolbar"], [role="menubar"], [role="menu"], [role="listbox"], [role="tablist"], [role="tree"], [role="treegrid"], [role="grid"], [role="radiogroup"]';
	const skipContext = (el: Element): boolean =>
		!!el.closest('[aria-hidden="true"], [inert], dialog:not([open])') ||
		(el as HTMLButtonElement).disabled === true ||
		el.getAttribute("aria-disabled") === "true" ||
		!isRendered(el);
	// Roving tabindex: the widget moves tabindex="0" between its children, so a "-1" is intentional.
	const roving = (el: Element): boolean => {
		if (el.closest(COMPOSITE)) return true;
		const container = el.parentElement?.closest('[tabindex="0"]');
		if (container && container !== el) return true;
		const siblings = Array.from(el.parentElement?.children ?? []);
		return siblings.some((s) => s !== el && s.getAttribute("tabindex") === "0");
	};

	const issues: KeyboardIssue[] = [];
	const seen = new Set<Element>();
	const push = (el: Element, kind: KeyboardIssue["kind"], detail: string) => {
		if (seen.has(el) || issues.length >= input.limit) return;
		seen.add(el);
		issues.push({
			kind,
			selector: selectorFor(el),
			tag: el.tagName.toLowerCase(),
			label: labelOf(el),
			detail,
		});
	};

	for (const el of Array.from(document.querySelectorAll('[onclick], [role="button"], [role="link"]'))) {
		const tag = el.tagName.toLowerCase();
		if (tag === "body" || tag === "html" || tag === "label" || tag === "option") continue;
		if (skipContext(el)) continue;
		if (el.matches(NATIVE)) continue; // judged below when tabindex removes it
		// A control inside a link or button is reached through its parent; a wrapper around one
		// (a clickable card with a real link inside) delegates to it.
		if (el.parentElement?.closest(NATIVE)) continue;
		if (el.querySelector(NATIVE)) continue;
		const tabindex = el.getAttribute("tabindex");
		if (tabindex === null) {
			const why = el.hasAttribute("onclick") ? "an onclick handler" : `role="${el.getAttribute("role")}"`;
			push(el, "not-focusable", `<${tag}> has ${why} but no tabindex, so Tab never reaches it`);
		} else if (Number.parseInt(tabindex, 10) < 0 && !roving(el)) {
			push(el, "removed", `<${tag}> has role="${el.getAttribute("role") ?? "button"}" and tabindex="-1"`);
		}
	}

	for (const el of Array.from(
		document.querySelectorAll(
			'a[href][tabindex="-1"], button[tabindex="-1"], select[tabindex="-1"], textarea[tabindex="-1"], input[tabindex="-1"]',
		),
	)) {
		if (el instanceof HTMLInputElement && el.type === "hidden") continue;
		if (skipContext(el) || roving(el)) continue;
		push(el, "removed", `<${el.tagName.toLowerCase()}> is natively focusable but carries tabindex="-1"`);
	}

	for (const el of Array.from(document.querySelectorAll("[tabindex]"))) {
		const value = Number.parseInt(el.getAttribute("tabindex") ?? "", 10);
		if (!(value > 0) || skipContext(el)) continue;
		push(el, "positive-tabindex", `tabindex="${value}" pulls the element out of document order`);
	}
	return issues;
}

interface SkipLinkProbe {
	verdict: "ok" | "missing" | "broken" | "unknown";
	leading: number;
	first?: { tag: string; text: string; href: string; selector: string };
	anchor?: string;
}

/** Is the first tabbable element a working skip link? Runs in the page. */
function probeSkipLink(input: { minLeading: number }): SkipLinkProbe {
	const selectorFor = (el: Element): string => {
		const testId = el.getAttribute("data-testid");
		if (testId) return `[data-testid="${testId}"]`;
		const id = el.getAttribute("id");
		if (id) return `#${CSS.escape(id)}`;
		const parts: string[] = [];
		let node: Element | null = el;
		while (node && node.tagName.toLowerCase() !== "body" && parts.length < 6) {
			const parent: Element | null = node.parentElement;
			if (!parent) break;
			const same = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
			parts.unshift(
				same.length > 1
					? `${node.tagName.toLowerCase()}:nth-of-type(${same.indexOf(node) + 1})`
					: node.tagName.toLowerCase(),
			);
			node = parent;
		}
		return parts.join(" > ");
	};
	const isRendered = (el: Element): boolean => {
		const rect = el.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return false;
		const check = (el as Element & { checkVisibility?: (options?: unknown) => boolean }).checkVisibility;
		if (typeof check === "function") {
			// A skip link is often clipped to 1px until focused; opacity 0 is still tabbable.
			return check.call(el, { contentVisibilityAuto: true, visibilityProperty: true });
		}
		const style = getComputedStyle(el);
		return style.display !== "none" && style.visibility !== "hidden";
	};
	const candidates = Array.from(
		document.querySelectorAll(
			'a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable=""], [contenteditable="true"]',
		),
	).filter((el) => {
		if ((el as HTMLButtonElement).disabled) return false;
		if (el instanceof HTMLInputElement && el.type === "hidden") return false;
		const tabindex = el.getAttribute("tabindex");
		if (tabindex !== null && Number.parseInt(tabindex, 10) < 0) return false;
		if (el.closest('[aria-hidden="true"], [inert], dialog:not([open])')) return false;
		return isRendered(el);
	});
	// DOM order. A positive tabindex would jump the queue, but that is a11y/keyboard-reachable's
	// finding; this rule asks what the first element of the page's own order is.
	const tabbables = candidates;
	const main = document.querySelector('main, [role="main"]') ?? document.querySelector("h1");
	const first = tabbables[0];
	if (!main || !first) return { verdict: "unknown", leading: 0 };
	const leading = tabbables.filter(
		(el) => !main.contains(el) && !!(main.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING),
	).length;
	const describe = (el: Element) => ({
		tag: el.tagName.toLowerCase(),
		text: (el.getAttribute("aria-label") || (el.textContent ?? "")).replace(/\s+/g, " ").trim().slice(0, 60),
		href: el.getAttribute("href") ?? "",
		selector: selectorFor(el),
	});
	if (main.contains(first)) return { verdict: "ok", leading };
	const text = (first.getAttribute("aria-label") || first.textContent || "").replace(/\s+/g, " ").trim();
	if (first.tagName.toLowerCase() === "a" && first.hasAttribute("href")) {
		let url: URL | undefined;
		try {
			url = new URL(first.getAttribute("href") ?? "", location.href);
		} catch {
			url = undefined;
		}
		if (url && url.origin === location.origin && url.pathname === location.pathname && url.hash.length > 1) {
			const anchor = decodeURIComponent(url.hash.slice(1));
			const target =
				document.getElementById(anchor) ?? document.querySelector(`a[name="${CSS.escape(anchor)}"]`);
			if (target) return { verdict: "ok", leading };
			return { verdict: "broken", leading, first: describe(first), anchor };
		}
	} else if (first.tagName.toLowerCase() === "button" && /\b(skip|jump) to\b/i.test(text)) {
		return { verdict: "ok", leading };
	}
	return { verdict: leading >= input.minLeading ? "missing" : "ok", leading, first: describe(first) };
}

interface MotionHit {
	kind: "animation" | "transition";
	name: string;
	selector: string;
	tag: string;
	detail: string;
}

/** Animations and transitions still active while reduced motion is emulated. Runs in the page. */
function findMotion(input: { thresholdMs: number; scanLimit: number; limit: number }): MotionHit[] {
	const selectorFor = (el: Element): string => {
		const testId = el.getAttribute("data-testid");
		if (testId) return `[data-testid="${testId}"]`;
		const id = el.getAttribute("id");
		if (id) return `#${CSS.escape(id)}`;
		const parts: string[] = [];
		let node: Element | null = el;
		while (node && node.tagName.toLowerCase() !== "body" && parts.length < 6) {
			const parent: Element | null = node.parentElement;
			if (!parent) break;
			const same = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
			parts.unshift(
				same.length > 1
					? `${node.tagName.toLowerCase()}:nth-of-type(${same.indexOf(node) + 1})`
					: node.tagName.toLowerCase(),
			);
			node = parent;
		}
		return parts.join(" > ");
	};
	const isRendered = (el: Element): boolean => {
		const rect = el.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return false;
		const check = (el as Element & { checkVisibility?: (options?: unknown) => boolean }).checkVisibility;
		if (typeof check === "function") {
			return check.call(el, { contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true });
		}
		const style = getComputedStyle(el);
		return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
	};
	const list = (value: string): string[] => value.split(",").map((v) => v.trim());
	const ms = (value: string): number => {
		const m = value.match(/^(-?[\d.]+)(ms|s)$/);
		if (!m) return 0;
		return m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1]);
	};
	const MOTION_PROPS = new Set([
		"all",
		"transform",
		"translate",
		"scale",
		"rotate",
		"offset",
		"offset-distance",
		"offset-path",
		"top",
		"left",
		"right",
		"bottom",
		"inset",
		"inset-inline",
		"inset-block",
		"margin",
		"margin-top",
		"margin-left",
		"margin-right",
		"margin-bottom",
	]);
	const hits: MotionHit[] = [];
	const seen = new Set<string>();
	const push = (el: Element, kind: MotionHit["kind"], name: string, detail: string, pseudo: string) => {
		const key = `${kind}:${name}:${el.tagName}:${pseudo}`;
		if (seen.has(key) || hits.length >= input.limit) return;
		seen.add(key);
		hits.push({ kind, name, selector: selectorFor(el) + pseudo, tag: el.tagName.toLowerCase(), detail });
	};
	const inspect = (el: Element, style: CSSStyleDeclaration, pseudo: string) => {
		if (style.animationName && style.animationName !== "none" && style.animationPlayState !== "paused") {
			const names = list(style.animationName);
			const durations = list(style.animationDuration).map(ms);
			const iterations = list(style.animationIterationCount);
			names.forEach((name, i) => {
				if (name === "none") return;
				const duration = durations[i % durations.length] ?? 0;
				const iteration = iterations[i % iterations.length] ?? "1";
				const infinite = iteration === "infinite";
				const total = infinite ? Number.POSITIVE_INFINITY : duration * Number(iteration);
				if (duration <= 0 || !(total >= input.thresholdMs)) return;
				push(
					el,
					"animation",
					name,
					`animation "${name}" runs ${infinite ? "forever" : `for ${Math.round(total)}ms`} (${duration}ms × ${iteration})`,
					pseudo,
				);
			});
		}
		if (style.transitionProperty && style.transitionProperty !== "none") {
			const props = list(style.transitionProperty);
			const durations = list(style.transitionDuration).map(ms);
			props.forEach((prop, i) => {
				const duration = durations[i % durations.length] ?? 0;
				if (!MOTION_PROPS.has(prop) || duration < input.thresholdMs) return;
				push(el, "transition", prop, `transition on ${prop} lasts ${duration}ms`, pseudo);
			});
		}
	};
	let scanned = 0;
	for (const el of Array.from(document.body?.querySelectorAll("*") ?? [])) {
		if (scanned >= input.scanLimit || hits.length >= input.limit) break;
		if (el.closest("script, style, template, noscript")) continue;
		if (!isRendered(el)) continue;
		scanned += 1;
		inspect(el, getComputedStyle(el), "");
		inspect(el, getComputedStyle(el, "::before"), "::before");
		inspect(el, getComputedStyle(el, "::after"), "::after");
	}
	return hits;
}

/** a11y/focus-visible, a11y/keyboard-reachable, a11y/skip-link, a11y/reduced-motion. */
export async function checkA11y(ctx: CheckContext): Promise<Finding[]> {
	const out: Finding[] = [];
	const rules = ["a11y/focus-visible", "a11y/keyboard-reachable", "a11y/skip-link", "a11y/reduced-motion"];
	if (!rules.some((r) => ruleEnabled(ctx, r))) return out;

	if (ruleEnabled(ctx, "a11y/keyboard-reachable")) {
		const issues = await ctx.page.raw
			.evaluate(findKeyboardIssues, { limit: MAX_FINDINGS })
			.catch(() => [] as KeyboardIssue[]);
		for (const issue of issues) {
			const what = issue.label ? `<${issue.tag}> "${truncate(issue.label, 40)}"` : `<${issue.tag}>`;
			const title =
				issue.kind === "positive-tabindex"
					? `${what} uses a positive tabindex`
					: `${what} cannot be reached with Tab`;
			report(ctx, out, "a11y/keyboard-reachable", {
				title,
				message: `${issue.detail} on ${ctx.route}.`,
				subject: issue.selector,
				location: { selector: issue.selector },
				suggestion:
					issue.kind === "positive-tabindex"
						? 'Use tabindex="0" and let the DOM order define the tab order.'
						: undefined,
			});
		}
	}

	if (ruleEnabled(ctx, "a11y/skip-link")) {
		const probe = await ctx.page.raw
			.evaluate(probeSkipLink, { minLeading: SKIP_LINK_MIN_LEADING })
			.catch((): SkipLinkProbe => ({ verdict: "unknown", leading: 0 }));
		if (probe.verdict === "missing" && probe.first) {
			const first = probe.first;
			const label = first.text ? `<${first.tag}> "${truncate(first.text, 40)}"` : `<${first.tag}>`;
			report(ctx, out, "a11y/skip-link", {
				title: "Page has no skip link",
				message: `The first tabbable element is ${label}, and ${probe.leading} tabbable elements come before the main content. Keyboard users have to tab through all of them on every visit.`,
				subject: "missing",
				location: { selector: first.selector },
			});
		} else if (probe.verdict === "broken" && probe.first) {
			report(ctx, out, "a11y/skip-link", {
				title: `Skip link target #${truncate(probe.anchor ?? "", 40)} does not exist`,
				message: `The first tabbable element links to "${probe.first.href}", but no element on ${ctx.route} has that id or name.`,
				subject: `#${probe.anchor ?? ""}`,
				location: { selector: probe.first.selector },
				suggestion: "Give the main content the id the skip link points to.",
			});
		}
	}

	if (ruleEnabled(ctx, "a11y/focus-visible")) {
		const probe = await ctx.page.raw
			.evaluate(probeFocusStyles, { limit: FOCUS_PROBE_LIMIT })
			.catch((): FocusProbe => ({ examined: 0, unstyled: [] }));
		// Elements sharing a tag and class list share a stylesheet rule; one finding per rule.
		const groups = new Map<string, { first: FocusProbe["unstyled"][number]; count: number }>();
		for (const hit of probe.unstyled) {
			const key = `${hit.tag}.${hit.className}`;
			const group = groups.get(key);
			if (group) group.count += 1;
			else groups.set(key, { first: hit, count: 1 });
		}
		for (const { first, count } of [...groups.values()].slice(0, MAX_FINDINGS)) {
			const label = first.label ? `<${first.tag}> "${truncate(first.label, 40)}"` : `<${first.tag}>`;
			const others =
				count > 1 ? ` ${count - 1} more element(s) with the same tag and classes behave alike.` : "";
			report(ctx, out, "a11y/focus-visible", {
				title: `${label} shows no focus indicator`,
				message: `Outline, box-shadow, border, background, color and pseudo-elements are identical before and after focus, so keyboard users cannot see where they are.${others}`,
				subject: first.selector,
				location: { selector: first.selector },
				evidence: { data: { tag: first.tag, className: first.className, count } },
			});
		}
	}

	if (ruleEnabled(ctx, "a11y/reduced-motion")) {
		const page = ctx.page.raw;
		const alreadyReduced = await page
			.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)
			.catch(() => false);
		let hits: MotionHit[] = [];
		try {
			if (!alreadyReduced) await page.emulateMedia({ reducedMotion: "reduce" });
			hits = await page.evaluate(findMotion, {
				thresholdMs: MOTION_THRESHOLD_MS,
				scanLimit: MOTION_SCAN_LIMIT,
				limit: MAX_FINDINGS,
			});
		} catch {
			hits = [];
		} finally {
			// Back to whatever the session emulated before, so later checks and the screenshot see the
			// page the way the user does.
			if (!alreadyReduced) await page.emulateMedia({ reducedMotion: null }).catch(() => {});
		}
		for (const hit of hits) {
			report(ctx, out, "a11y/reduced-motion", {
				title: `<${hit.tag}> keeps ${hit.kind === "animation" ? "animating" : "transitioning"} under prefers-reduced-motion`,
				message: `With prefers-reduced-motion: reduce emulated, ${hit.detail} on ${hit.selector}.`,
				subject: `${hit.kind}:${hit.name}`,
				location: { selector: hit.selector },
				evidence: { data: { kind: hit.kind, name: hit.name } },
			});
		}
	}
	return out;
}
