/**
 * The in-page half of `page_snapshot`. `collectSnapshot` is serialized by Playwright and executed in
 * the browser, so it must be fully self-contained: no imports, no references to module scope.
 * Keep every helper inside the function body.
 */

export interface SnapshotScriptOptions {
	maxChars: number;
	includeDom: boolean;
	refAttribute: string;
	tokens?: { colors?: string[]; fontSizes?: string[]; spacing?: string[] };
	minFontPx?: number;
	minTouchPx?: number;
	/** Maximum number of elements sampled for style checks. */
	styleSampleLimit: number;
}

export interface SnapshotScriptResult {
	dom: string;
	interactive: Array<{
		ref: string;
		role: string;
		name: string;
		tag: string;
		selector: string;
		testId?: string;
		id?: string;
		box: { x: number; y: number; width: number; height: number };
		disabled?: boolean;
		href?: string;
	}>;
	layout: Array<{
		kind: "overlap" | "overflow-x" | "small-touch-target" | "text-clipped" | "offscreen";
		refs: string[];
		detail: string;
		selectors?: string[];
	}>;
	styles: Array<{
		kind: "color" | "font-size" | "spacing" | "min-font-size";
		ref: string;
		selector: string;
		property: string;
		value: string;
		expected?: string;
		text?: string;
	}>;
	domNodes: number;
	viewport: { width: number; height: number };
	scrollWidth: number;
	clientWidth: number;
}

export function collectSnapshot(opts: SnapshotScriptOptions): SnapshotScriptResult {
	const REF_ATTR = opts.refAttribute;
	const doc = document;
	const win = window;

	// ------------------------------------------------------------ helpers
	const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

	const cssEscape = (value: string): string =>
		typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");

	/**
	 * Is the element actually rendered? `checkVisibility` knows about things a computed style does
	 * not — most importantly `content-visibility`, which is how Chromium hides the contents of a
	 * closed `<details>` (through the `::details-content` pseudo-element, so the descendant's own
	 * computed `content-visibility` still reads `visible`). The options matter: the bare call
	 * ignores both `visibility` and `opacity`.
	 */
	const isRendered = (el: Element): boolean => {
		const rect = el.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return false;
		const check = (el as Element & { checkVisibility?: (options?: unknown) => boolean }).checkVisibility;
		if (typeof check === "function") {
			return check.call(el, {
				contentVisibilityAuto: true,
				opacityProperty: true,
				visibilityProperty: true,
			});
		}
		const style = win.getComputedStyle(el);
		if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse")
			return false;
		return style.opacity !== "0";
	};

	// The visually-hidden idiom (Tailwind `sr-only`, Bootstrap `.visually-hidden`): a real 1px box
	// that is clipped away and restored on focus. `checkVisibility` calls it visible, because it is —
	// it is simply not meant to be perceived, so measuring its box is meaningless.
	const CLIP_ZERO_RECT =
		/^rect\(\s*0(?:px)?(?:\s*,\s*|\s+)0(?:px)?(?:\s*,\s*|\s+)0(?:px)?(?:\s*,\s*|\s+)0(?:px)?\s*\)$/;
	const CLIP_PATH_INSET_HALF = /^inset\(\s*50%(?:\s+50%){0,3}\s*\)$/;

	const isVisuallyHidden = (el: Element, precomputed?: CSSStyleDeclaration): boolean => {
		const rect = el.getBoundingClientRect();
		if (rect.width > 1 || rect.height > 1) return false;
		const style = precomputed ?? win.getComputedStyle(el);
		if (CLIP_ZERO_RECT.test(style.clip.trim())) return true;
		if (CLIP_PATH_INSET_HALF.test(style.clipPath.trim())) return true;
		return (
			style.overflow === "hidden" &&
			style.position === "absolute" &&
			style.width === "1px" &&
			style.height === "1px"
		);
	};

	const implicitRole = (el: Element): string => {
		const tag = el.tagName.toLowerCase();
		switch (tag) {
			case "a":
				return el.hasAttribute("href") ? "link" : "generic";
			case "button":
				return "button";
			case "select":
				return el.hasAttribute("multiple") || Number(el.getAttribute("size") ?? 0) > 1
					? "listbox"
					: "combobox";
			case "textarea":
				return "textbox";
			case "summary":
				return "button";
			case "input": {
				const type = (el.getAttribute("type") ?? "text").toLowerCase();
				if (type === "checkbox") return "checkbox";
				if (type === "radio") return "radio";
				if (type === "submit" || type === "button" || type === "reset" || type === "image") return "button";
				if (type === "range") return "slider";
				if (type === "number") return "spinbutton";
				if (type === "search") return "searchbox";
				if (type === "hidden") return "";
				return "textbox";
			}
			case "nav":
				return "navigation";
			case "main":
				return "main";
			case "header":
				return "banner";
			case "footer":
				return "contentinfo";
			case "form":
				return "form";
			case "h1":
			case "h2":
			case "h3":
			case "h4":
			case "h5":
			case "h6":
				return "heading";
			case "img":
				return "img";
			case "ul":
			case "ol":
				return "list";
			case "li":
				return "listitem";
			case "table":
				return "table";
			case "dialog":
				return "dialog";
			default:
				return "";
		}
	};

	const roleOf = (el: Element): string => el.getAttribute("role")?.trim().split(/\s+/)[0] ?? implicitRole(el);

	const labelledByText = (el: Element): string => {
		const ids = el.getAttribute("aria-labelledby");
		if (!ids) return "";
		return collapse(
			ids
				.split(/\s+/)
				.map((id) => doc.getElementById(id)?.textContent ?? "")
				.join(" "),
		);
	};

	const accessibleName = (el: Element): string => {
		const ariaLabel = el.getAttribute("aria-label");
		if (ariaLabel?.trim()) return collapse(ariaLabel);
		const byIds = labelledByText(el);
		if (byIds) return byIds;
		const tag = el.tagName.toLowerCase();
		if (tag === "input" || tag === "textarea" || tag === "select") {
			const input = el as HTMLInputElement;
			if (input.labels && input.labels.length > 0) {
				const text = collapse(Array.from(input.labels, (l) => l.textContent ?? "").join(" "));
				if (text) return text;
			}
			const type = (el.getAttribute("type") ?? "").toLowerCase();
			if (type === "submit" || type === "button" || type === "reset") {
				return collapse(input.value || (type === "submit" ? "Submit" : type === "reset" ? "Reset" : ""));
			}
			if (type === "image") return collapse(el.getAttribute("alt") ?? "");
			return collapse(el.getAttribute("placeholder") ?? el.getAttribute("title") ?? "");
		}
		if (tag === "img") return collapse(el.getAttribute("alt") ?? "");
		let text = collapse(el.textContent ?? "");
		if (!text) {
			const img = el.querySelector("img[alt], svg[aria-label], [aria-label]");
			text = collapse(img?.getAttribute("alt") ?? img?.getAttribute("aria-label") ?? "");
		}
		if (!text) text = collapse(el.getAttribute("title") ?? "");
		return text.slice(0, 120);
	};

	const structuralPath = (el: Element): string => {
		const parts: string[] = [];
		let node: Element | null = el;
		while (node && node !== doc.documentElement && parts.length < 8) {
			const tag = node.tagName.toLowerCase();
			const parent: Element | null = node.parentElement;
			if (!parent) break;
			const siblings = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
			parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})` : tag);
			if (tag === "body") break;
			node = parent;
		}
		return parts.join(" > ");
	};

	const stableSelector = (el: Element): string => {
		const testId =
			el.getAttribute("data-testid") ?? el.getAttribute("data-test-id") ?? el.getAttribute("data-test");
		if (testId) return `[data-testid="${testId.replace(/"/g, '\\"')}"]`;
		const id = el.getAttribute("id");
		if (id && /^[A-Za-z][\w-]*$/.test(id) && doc.querySelectorAll(`#${cssEscape(id)}`).length === 1) {
			return `#${cssEscape(id)}`;
		}
		return structuralPath(el);
	};

	const INTERACTIVE_ROLES = new Set([
		"button",
		"link",
		"checkbox",
		"radio",
		"textbox",
		"searchbox",
		"combobox",
		"listbox",
		"slider",
		"spinbutton",
		"switch",
		"tab",
		"menuitem",
		"menuitemcheckbox",
		"menuitemradio",
		"option",
	]);

	const isInteractive = (el: Element): boolean => {
		const tag = el.tagName.toLowerCase();
		if (tag === "a" && el.hasAttribute("href")) return true;
		if (tag === "button" || tag === "select" || tag === "textarea" || tag === "summary") return true;
		if (tag === "input") return (el.getAttribute("type") ?? "").toLowerCase() !== "hidden";
		if (INTERACTIVE_ROLES.has(el.getAttribute("role") ?? "")) return true;
		if (el.hasAttribute("onclick")) return true;
		const tabindex = el.getAttribute("tabindex");
		if (tabindex !== null && Number(tabindex) >= 0 && tag !== "div" && tag !== "span") return true;
		return false;
	};

	// ------------------------------------------------------- interactive
	for (const stale of Array.from(doc.querySelectorAll(`[${REF_ATTR}]`))) stale.removeAttribute(REF_ATTR);

	const interactive: SnapshotScriptResult["interactive"] = [];
	const elementByRef = new Map<string, Element>();
	let counter = 0;
	for (const el of Array.from(doc.body?.querySelectorAll("*") ?? [])) {
		if (!isInteractive(el)) continue;
		if (!isRendered(el)) continue;
		const rect = el.getBoundingClientRect();
		counter += 1;
		const ref = `e${counter}`;
		el.setAttribute(REF_ATTR, ref);
		elementByRef.set(ref, el);
		const entry: SnapshotScriptResult["interactive"][number] = {
			ref,
			role: roleOf(el) || el.tagName.toLowerCase(),
			name: accessibleName(el),
			tag: el.tagName.toLowerCase(),
			selector: stableSelector(el),
			box: {
				x: Math.round(rect.left + win.scrollX),
				y: Math.round(rect.top + win.scrollY),
				width: Math.round(rect.width),
				height: Math.round(rect.height),
			},
		};
		const testId = el.getAttribute("data-testid");
		if (testId) entry.testId = testId;
		const id = el.getAttribute("id");
		if (id) entry.id = id;
		if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true")
			entry.disabled = true;
		const href = el.getAttribute("href");
		if (href !== null) entry.href = href;
		interactive.push(entry);
	}

	// ------------------------------------------------------------ layout
	const layout: SnapshotScriptResult["layout"] = [];
	const viewport = { width: win.innerWidth, height: win.innerHeight };

	const overlapPairs = new Set<string>();
	// Inline elements that wrap across lines (a link inside a paragraph) have a bounding box that
	// covers the whole line block; comparing those boxes yields phantom overlaps.
	const wrapsLines = (el: Element): boolean =>
		win.getComputedStyle(el).display === "inline" && el.getClientRects().length > 1;
	// An element buried under an overlay (a modal backdrop, a cookie curtain) cannot overlap
	// anything anyone can see. The probe is one `elementFromPoint` per candidate, and only counts as
	// covered when the thing on top is not interactive itself: in a genuine overlap the element on
	// top *is* one of the candidates, and that pair is precisely what we want to report.
	const coveredByOverlay = (el: Element): boolean => {
		if (typeof doc.elementFromPoint !== "function") return false;
		const rect = el.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + rect.height / 2;
		// A partially off-screen element has no centre worth probing; elementFromPoint would say null.
		if (cx < 0 || cy < 0 || cx >= viewport.width || cy >= viewport.height) return false;
		const hit = doc.elementFromPoint(cx, cy);
		if (!hit || hit === el || el.contains(hit) || hit.contains(el)) return false;
		for (let node: Element | null = hit; node; node = node.parentElement) {
			if (node.hasAttribute(REF_ATTR)) return false;
		}
		return true;
	};
	const candidates = interactive.filter((e) => {
		if (e.box.width <= 0 || e.box.height <= 0) return false;
		const el = elementByRef.get(e.ref)!;
		return !wrapsLines(el) && !coveredByOverlay(el);
	});
	for (let i = 0; i < candidates.length && i < 400; i++) {
		const a = candidates[i]!;
		const elA = elementByRef.get(a.ref)!;
		for (let j = i + 1; j < candidates.length && j < 400; j++) {
			const b = candidates[j]!;
			const elB = elementByRef.get(b.ref)!;
			if (elA.contains(elB) || elB.contains(elA)) continue;
			const x = Math.max(
				0,
				Math.min(a.box.x + a.box.width, b.box.x + b.box.width) - Math.max(a.box.x, b.box.x),
			);
			const y = Math.max(
				0,
				Math.min(a.box.y + a.box.height, b.box.y + b.box.height) - Math.max(a.box.y, b.box.y),
			);
			const area = x * y;
			if (area < 4) continue;
			const smaller = Math.min(a.box.width * a.box.height, b.box.width * b.box.height);
			if (area / smaller < 0.25) continue;
			const key = `${a.ref}|${b.ref}`;
			if (overlapPairs.has(key)) continue;
			overlapPairs.add(key);
			layout.push({
				kind: "overlap",
				refs: [a.ref, b.ref],
				selectors: [a.selector, b.selector],
				detail: `${a.role} "${a.name || a.selector}" overlaps ${b.role} "${b.name || b.selector}" by ${Math.round(area)}px²`,
			});
			if (layout.length > 50) break;
		}
	}

	const root = doc.documentElement;
	const scrollWidth = Math.max(root.scrollWidth, doc.body?.scrollWidth ?? 0);
	const clientWidth = root.clientWidth;
	if (scrollWidth > clientWidth + 1) {
		// Find the widest elements that poke past the viewport.
		const offenders: Array<{ selector: string; ref?: string; right: number }> = [];
		for (const el of Array.from(doc.body?.querySelectorAll("*") ?? []).slice(0, 5000)) {
			const rect = el.getBoundingClientRect();
			if (rect.width === 0) continue;
			const right = rect.right + win.scrollX;
			if (right > clientWidth + 1 && rect.left + win.scrollX < clientWidth) {
				const ref = el.getAttribute(REF_ATTR) ?? undefined;
				offenders.push({ selector: stableSelector(el), ref, right });
			}
		}
		offenders.sort((a, b) => b.right - a.right);
		const top = offenders.slice(0, 3);
		layout.push({
			kind: "overflow-x",
			refs: top.map((o) => o.ref).filter((r): r is string => !!r),
			selectors: top.map((o) => o.selector),
			detail: `document scrolls horizontally: scrollWidth ${scrollWidth}px > clientWidth ${clientWidth}px${
				top.length
					? `; widest: ${top.map((o) => `${o.selector} (right edge ${Math.round(o.right)}px)`).join(", ")}`
					: ""
			}`,
		});
	}

	if (opts.minTouchPx) {
		const min = opts.minTouchPx;
		// WCAG 2.5.8 exempts inline targets in a block of text; anything else needs to be
		// comfortably tappable: flag when both dimensions miss the configured minimum, or when the
		// smaller one is below the 24px hard floor.
		const HARD_FLOOR = 24;
		for (const e of interactive) {
			if (e.box.width <= 0 || e.box.height <= 0) continue;
			const el = elementByRef.get(e.ref);
			if (!el) continue;
			if (e.tag === "input" && ["checkbox", "radio"].includes(el.getAttribute("type") ?? "")) continue;
			const style = win.getComputedStyle(el);
			if (style.display === "inline") continue;
			if (isVisuallyHidden(el, style)) continue;
			const smaller = Math.min(e.box.width, e.box.height);
			const bothTooSmall = e.box.width < min && e.box.height < min;
			if (bothTooSmall || smaller < Math.min(min, HARD_FLOOR)) {
				layout.push({
					kind: "small-touch-target",
					refs: [e.ref],
					selectors: [e.selector],
					detail: `${e.role} "${e.name || e.selector}" is ${e.box.width}×${e.box.height}px, below ${min}px`,
				});
			}
		}
	}

	for (const e of interactive) {
		if (e.box.width <= 0) continue;
		if (e.box.x + e.box.width < 0 || e.box.x > Math.max(clientWidth, scrollWidth)) {
			layout.push({
				kind: "offscreen",
				refs: [e.ref],
				selectors: [e.selector],
				detail: `${e.role} "${e.name || e.selector}" sits outside the horizontal document bounds (x=${e.box.x})`,
			});
		}
	}

	// text clipped: elements with overflow hidden whose content is wider than the box and that hold text directly
	let clippedCount = 0;
	for (const el of Array.from(doc.body?.querySelectorAll("*") ?? []).slice(0, 5000)) {
		if (clippedCount >= 20) break;
		const hasDirectText = Array.from(el.childNodes).some(
			(n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 0,
		);
		if (!hasDirectText) continue;
		if (!isRendered(el)) continue;
		const style = win.getComputedStyle(el);
		if (isVisuallyHidden(el, style)) continue;
		const overflowHidden =
			style.overflowX === "hidden" || style.overflow === "hidden" || style.overflowX === "clip";
		if (!overflowHidden) continue;
		if (style.textOverflow === "ellipsis") continue;
		if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
			clippedCount += 1;
			const ref = el.getAttribute(REF_ATTR) ?? "";
			layout.push({
				kind: "text-clipped",
				refs: ref ? [ref] : [],
				selectors: [stableSelector(el)],
				detail: `text "${collapse(el.textContent ?? "").slice(0, 60)}" is clipped: content ${el.scrollWidth}px wide in a ${el.clientWidth}px box`,
			});
		}
	}

	// ------------------------------------------------------------ styles
	const styles: SnapshotScriptResult["styles"] = [];
	const normalizeColor = (value: string): string => {
		const m = value.match(/^rgba?\(([^)]+)\)$/i);
		if (!m) return value.trim().toLowerCase();
		const parts = m[1]!
			.split(/[\s,/]+/)
			.filter(Boolean)
			.map(Number);
		const [r = 0, g = 0, b = 0] = parts;
		const a = parts.length > 3 ? parts[3]! : 1;
		if (a === 0) return "transparent";
		const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
		return `#${hex(r)}${hex(g)}${hex(b)}`;
	};
	const tokens = opts.tokens;
	const colorTokens = tokens?.colors ? new Set(tokens.colors.map((c) => normalizeColor(c))) : undefined;
	const fontTokens = tokens?.fontSizes
		? new Set(tokens.fontSizes.map((f) => f.replace(/px$/, "").trim()))
		: undefined;
	const spacingTokens = tokens?.spacing
		? new Set(tokens.spacing.map((v) => String(Math.round(Number.parseFloat(v) * 100) / 100)))
		: undefined;
	const needStyles = !!colorTokens || !!fontTokens || !!opts.minFontPx;
	if (needStyles) {
		let sampled = 0;
		const seenColor = new Set<string>();
		const seenFont = new Set<string>();
		for (const el of Array.from(doc.body?.querySelectorAll("*") ?? [])) {
			if (sampled >= opts.styleSampleLimit) break;
			const hasDirectText = Array.from(el.childNodes).some(
				(n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 0,
			);
			if (!hasDirectText) continue;
			if (!isRendered(el)) continue;
			sampled += 1;
			const style = win.getComputedStyle(el);
			const ref = el.getAttribute(REF_ATTR) ?? "";
			const selector = stableSelector(el);
			const text = collapse(el.textContent ?? "").slice(0, 60);
			const fontPx = Number.parseFloat(style.fontSize);
			if (opts.minFontPx && Number.isFinite(fontPx) && fontPx < opts.minFontPx) {
				styles.push({
					kind: "min-font-size",
					ref,
					selector,
					property: "font-size",
					value: `${fontPx}px`,
					expected: `>= ${opts.minFontPx}px`,
					text,
				});
			}
			if (fontTokens && Number.isFinite(fontPx)) {
				const key = String(Math.round(fontPx * 100) / 100);
				if (!fontTokens.has(key) && !seenFont.has(key)) {
					seenFont.add(key);
					styles.push({ kind: "font-size", ref, selector, property: "font-size", value: `${key}px`, text });
				}
			}
			if (colorTokens) {
				for (const prop of ["color", "background-color"] as const) {
					const raw = prop === "color" ? style.color : style.backgroundColor;
					const norm = normalizeColor(raw);
					if (norm === "transparent" || norm === "inherit" || norm === "currentcolor") continue;
					if (colorTokens.has(norm)) continue;
					const key = `${prop}:${norm}`;
					if (seenColor.has(key)) continue;
					seenColor.add(key);
					styles.push({ kind: "color", ref, selector, property: prop, value: norm, text });
				}
			}
		}
	}

	// Spacing: every rendered element, not only text carriers, because margins and paddings live
	// on containers. The browser's own default margins (a <p>'s 1em, a <ul>'s 40px padding) are
	// not the author's choice, so they are allowed even when they are not tokens.
	if (spacingTokens && spacingTokens.size > 0) {
		const UA_EM: Record<string, Partial<Record<string, number>>> = {
			p: { mt: 1, mb: 1 },
			h1: { mt: 0.67, mb: 0.67 },
			h2: { mt: 0.83, mb: 0.83 },
			h3: { mt: 1, mb: 1 },
			h4: { mt: 1.33, mb: 1.33 },
			h5: { mt: 1.67, mb: 1.67 },
			h6: { mt: 2.33, mb: 2.33 },
			ul: { mt: 1, mb: 1 },
			ol: { mt: 1, mb: 1 },
			menu: { mt: 1, mb: 1 },
			dl: { mt: 1, mb: 1 },
			blockquote: { mt: 1, mb: 1 },
			figure: { mt: 1, mb: 1 },
			pre: { mt: 1, mb: 1 },
			hr: { mt: 0.5, mb: 0.5 },
			fieldset: { pt: 0.35, pr: 0.75, pb: 0.625, pl: 0.75 },
		};
		const UA_PX: Record<string, Partial<Record<string, number>>> = {
			body: { mt: 8, mr: 8, mb: 8, ml: 8 },
			ul: { pl: 40 },
			ol: { pl: 40 },
			menu: { pl: 40 },
			dd: { ml: 40 },
			blockquote: { ml: 40, mr: 40 },
			figure: { ml: 40, mr: 40 },
			fieldset: { ml: 2, mr: 2 },
			legend: { pl: 2, pr: 2 },
			button: { pt: 1, pb: 1, pl: 6, pr: 6 },
			input: { pt: 1, pb: 1, pl: 2, pr: 2 },
			textarea: { pt: 2, pb: 2, pl: 2, pr: 2 },
			select: { pl: 2, pr: 2 },
			td: { pt: 1, pb: 1, pl: 1, pr: 1 },
			th: { pt: 1, pb: 1, pl: 1, pr: 1 },
			details: { ml: 0 },
			summary: { ml: 0 },
		};
		const PROPS: Array<[key: string, property: string]> = [
			["mt", "margin-top"],
			["mr", "margin-right"],
			["mb", "margin-bottom"],
			["ml", "margin-left"],
			["pt", "padding-top"],
			["pr", "padding-right"],
			["pb", "padding-bottom"],
			["pl", "padding-left"],
		];
		const SKIP_TAGS = new Set([
			"html",
			"body",
			"script",
			"style",
			"template",
			"noscript",
			"svg",
			"br",
			"wbr",
		]);
		const seenSpacing = new Set<string>();
		let spacingSampled = 0;
		for (const el of Array.from(doc.body?.querySelectorAll("*") ?? [])) {
			if (spacingSampled >= opts.styleSampleLimit) break;
			const tag = el.tagName.toLowerCase();
			if (SKIP_TAGS.has(tag) || el.closest("svg, math")) continue;
			if (!isRendered(el)) continue;
			const style = win.getComputedStyle(el);
			// The visually-hidden idiom sets margin: -1px to clip a 1px box; that is not spacing.
			if (isVisuallyHidden(el, style)) continue;
			spacingSampled += 1;
			const fontPx = Number.parseFloat(style.fontSize) || 16;
			const em = UA_EM[tag] ?? {};
			const px = UA_PX[tag] ?? {};
			const text = collapse(el.textContent ?? "").slice(0, 60);
			for (const [key, property] of PROPS) {
				const raw = style.getPropertyValue(property);
				const value = Number.parseFloat(raw);
				if (!Number.isFinite(value) || Math.abs(value) < 0.5) continue;
				const rounded = Math.round(Math.abs(value) * 100) / 100;
				if (spacingTokens.has(String(rounded))) continue;
				const uaDefault = em[key] !== undefined ? em[key]! * fontPx : px[key];
				if (uaDefault !== undefined && Math.abs(uaDefault - Math.abs(value)) < 0.5) continue;
				const dedupe = `${property}:${rounded}`;
				if (seenSpacing.has(dedupe)) continue;
				seenSpacing.add(dedupe);
				styles.push({
					kind: "spacing",
					ref: el.getAttribute(REF_ATTR) ?? "",
					selector: stableSelector(el),
					property,
					value: `${rounded}px`,
					text,
				});
			}
		}
	}

	// --------------------------------------------------------------- dom
	const DROP_TAGS = new Set(["script", "style", "noscript", "template", "link", "meta", "head"]);
	const KEEP_ATTRS = [
		"role",
		"href",
		"src",
		"alt",
		"name",
		"type",
		"placeholder",
		"value",
		"data-testid",
		"id",
		"for",
		"title",
		"lang",
		"target",
		"rel",
		"disabled",
		"checked",
		"selected",
		"required",
		"open",
		"tabindex",
		"action",
		"method",
		"datetime",
		"colspan",
		"rowspan",
		"scope",
	];
	const COLLAPSIBLE = new Set(["div", "span"]);

	interface DomNode {
		tag: string;
		attrs: string;
		children: Array<DomNode | string>;
		depth: number;
	}

	let domNodes = 0;
	const buildAttrs = (el: Element): string => {
		const out: string[] = [];
		const ref = el.getAttribute(REF_ATTR);
		if (ref) out.push(`ref=${ref}`);
		for (const attr of KEEP_ATTRS) {
			if (!el.hasAttribute(attr)) continue;
			let value = el.getAttribute(attr) ?? "";
			if (attr === "value" && el.tagName.toLowerCase() === "input") {
				const type = (el.getAttribute("type") ?? "").toLowerCase();
				if (type === "password") value = "***";
			}
			if (attr === "src" || attr === "href") value = value.length > 120 ? `${value.slice(0, 117)}...` : value;
			if (value === "") out.push(attr);
			else out.push(`${attr}="${collapse(value).replace(/"/g, "&quot;")}"`);
		}
		for (const a of Array.from(el.attributes)) {
			if (a.name.startsWith("aria-") && a.name !== "aria-hidden") {
				out.push(`${a.name}="${collapse(a.value).replace(/"/g, "&quot;")}"`);
			}
		}
		if (el.getAttribute("aria-hidden") === "true") out.push('aria-hidden="true"');
		return out.length ? ` ${out.join(" ")}` : "";
	};

	const build = (el: Element, depth: number): DomNode | string | undefined => {
		const tag = el.tagName.toLowerCase();
		if (DROP_TAGS.has(tag)) return undefined;
		domNodes += 1;
		if (tag === "svg") {
			const label = el.getAttribute("aria-label") ?? el.querySelector("title")?.textContent ?? "";
			return { tag: "svg", attrs: label ? ` aria-label="${collapse(label)}"` : "", children: [], depth };
		}
		const style = el instanceof HTMLElement ? win.getComputedStyle(el) : undefined;
		if (style && (style.display === "none" || style.visibility === "hidden")) return undefined;
		const attrs = buildAttrs(el);
		const children: Array<DomNode | string> = [];
		for (const child of Array.from(el.childNodes)) {
			if (child.nodeType === Node.TEXT_NODE) {
				const text = collapse(child.textContent ?? "");
				if (text) children.push(text);
			} else if (child.nodeType === Node.ELEMENT_NODE) {
				const built = build(child as Element, depth + 1);
				if (built !== undefined) children.push(built);
			}
		}
		if (COLLAPSIBLE.has(tag) && attrs === "" && children.length === 1 && typeof children[0] !== "string") {
			const only = children[0]!;
			only.depth = depth;
			return only;
		}
		if (COLLAPSIBLE.has(tag) && attrs === "" && children.length === 0) return undefined;
		return { tag, attrs, children, depth };
	};

	const render = (node: DomNode | string, indent: number, maxDepth: number, out: string[]): void => {
		const pad = "  ".repeat(indent);
		if (typeof node === "string") {
			out.push(`${pad}${node.length > 400 ? `${node.slice(0, 397)}...` : node}`);
			return;
		}
		if (node.depth > maxDepth) {
			out.push(`${pad}<${node.tag}${node.attrs}>…</${node.tag}>`);
			return;
		}
		const inlineText =
			node.children.length === 1 &&
			typeof node.children[0] === "string" &&
			(node.children[0] as string).length < 200;
		if (node.children.length === 0) {
			out.push(`${pad}<${node.tag}${node.attrs}/>`);
			return;
		}
		if (inlineText) {
			out.push(`${pad}<${node.tag}${node.attrs}>${node.children[0]}</${node.tag}>`);
			return;
		}
		out.push(`${pad}<${node.tag}${node.attrs}>`);
		for (const child of node.children) render(child, indent + 1, maxDepth, out);
		out.push(`${pad}</${node.tag}>`);
	};

	let dom = "";
	if (opts.includeDom && doc.body) {
		const tree = build(doc.body, 0);
		if (tree !== undefined) {
			let maxDepth = 64;
			while (maxDepth >= 0) {
				const lines: string[] = [];
				render(tree, 0, maxDepth, lines);
				dom = lines.join("\n");
				if (dom.length <= opts.maxChars) break;
				maxDepth -= 1;
			}
			if (dom.length > opts.maxChars) dom = `${dom.slice(0, opts.maxChars - 1)}…`;
		}
	} else {
		domNodes = doc.getElementsByTagName("*").length;
	}

	return {
		dom,
		interactive,
		layout,
		styles,
		domNodes: domNodes || doc.getElementsByTagName("*").length,
		viewport,
		scrollWidth,
		clientWidth,
	};
}
