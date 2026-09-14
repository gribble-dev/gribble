import { type TObject, Type } from "typebox";
import type { RuleSetting, Severity } from "../config/types.js";
import { RULE_IDS, type RuleCategory, type RuleId, ruleCategory } from "./ids.js";

export type PresetName = "recommended" | "strict" | "seo" | "a11y";

/** Everything the registry knows about a rule. Drives docs, `gribble explain`, config validation and finding links. */
export interface RuleMeta {
	id: RuleId;
	category: RuleCategory;
	/** One line, dry. */
	summary: string;
	/** A short paragraph: what is checked and why it matters. */
	description: string;
	/** TypeBox object schema for `[severity, options]`; absent when the rule takes no options. */
	optionsSchema?: TObject;
	defaultOptions?: Record<string, unknown>;
	/** Setting in each built-in preset. Missing means `off`. */
	presets: Partial<Record<PresetName, RuleSetting>>;
	/** True when the check is computed by code; false for AI review rules. */
	deterministic: boolean;
	/** False for rules that exist in the schema and docs but have no checker yet. */
	implemented: boolean;
	/** How to fix it, dry. */
	fix: string;
	examples?: { bad?: string; good?: string };
	docsUrl: string;
}

interface RuleDef {
	id: RuleId;
	summary: string;
	description: string;
	options?: { schema: TObject; defaults: Record<string, unknown> };
	recommended: RuleSetting;
	deterministic?: boolean;
	implemented: boolean;
	fix: string;
	examples?: { bad?: string; good?: string };
}

export const RULES_DOCS_BASE_URL = "https://gribble.dev/rules";

const STRICT_PROMOTED_CATEGORIES: ReadonlySet<RuleCategory> = new Set([
	"links",
	"network",
	"seo",
	"a11y",
	"html",
	"security",
]);

const stringList = (description: string, defaults: string[] = []) =>
	Type.Array(Type.String(), { description, default: defaults });

const defs: RuleDef[] = [
	// ---------------------------------------------------------------- links
	{
		id: "links/broken",
		summary: "Internal links must not resolve to a 4xx or 5xx response.",
		description:
			"Every same-origin anchor, image, script and stylesheet reference is requested. A response of 400 or above, a connection failure or a timeout is reported with the link target as the subject.",
		recommended: "error",
		implemented: true,
		fix: "Point the link at an existing route or asset, or remove it. For moved pages add a redirect instead of leaving a dead link.",
		examples: {
			bad: '<a href="/pricing-old">Pricing</a>  <!-- 404 -->',
			good: '<a href="/pricing">Pricing</a>',
		},
	},
	{
		id: "links/broken-external",
		summary: "External links must respond.",
		description:
			"Links to other origins are requested with a HEAD (falling back to GET) request. Hosts listed in `ignore` are skipped; some sites block automated requests, so this rule defaults to warn.",
		options: {
			schema: Type.Object(
				{
					timeout: Type.Integer({
						description: "Per-request timeout in milliseconds.",
						minimum: 1,
						default: 10000,
					}),
					ignore: stringList("Hostnames (or globs) that are never checked, e.g. sites that block bots.", [
						"linkedin.com",
					]),
				},
				{ additionalProperties: false },
			),
			defaults: { timeout: 10000, ignore: ["linkedin.com"] },
		},
		recommended: ["warn", { timeout: 10000, ignore: ["linkedin.com"] }],
		implemented: true,
		fix: "Update or remove the link. If the host blocks automated requests, add it to `ignore`.",
	},
	{
		id: "links/redirect-chain",
		summary: "Links must not go through more than `max` redirects.",
		description:
			"Each redirect adds a round trip and loses link equity. The rule counts the hops between the link target and the final 2xx response.",
		options: {
			schema: Type.Object(
				{
					max: Type.Integer({ description: "Maximum number of redirects allowed.", minimum: 0, default: 1 }),
				},
				{ additionalProperties: false },
			),
			defaults: { max: 1 },
		},
		recommended: ["warn", { max: 1 }],
		implemented: true,
		fix: "Link directly to the final URL.",
	},
	{
		id: "links/empty-href",
		summary: "Anchors must have a real destination.",
		description:
			'Reports `href="#"`, `href="javascript:void(0)"` and anchors without an href. These are usually buttons in disguise, which breaks keyboard access and "open in new tab".',
		recommended: "warn",
		implemented: true,
		fix: "Use a `<button>` for actions, or give the anchor a real URL.",
		examples: {
			bad: '<a href="#" onclick="open()">Open</a>',
			good: '<button type="button" onclick="open()">Open</button>',
		},
	},
	{
		id: "links/target-blank-noopener",
		summary: '`target="_blank"` links must set `rel="noopener"`.',
		description:
			"Without `noopener`, the opened page gets a reference to the opener window (reverse tabnabbing in older browsers). Modern browsers imply it, but the attribute keeps behaviour consistent.",
		recommended: "warn",
		implemented: true,
		fix: 'Add rel="noopener noreferrer" to the anchor.',
		examples: {
			bad: '<a href="https://example.com" target="_blank">Docs</a>',
			good: '<a href="https://example.com" target="_blank" rel="noopener noreferrer">Docs</a>',
		},
	},
	// -------------------------------------------------------------- network
	{
		id: "network/page-error",
		summary: "The route itself must load.",
		description:
			"The route's document response returned 5xx, the navigation failed, or the page threw an uncaught exception while rendering.",
		recommended: "critical",
		implemented: true,
		fix: "Open the route locally and read the server log or the browser console; this is a crash, not a nit.",
	},
	{
		id: "network/failed-requests",
		summary: "No request made by the page may fail.",
		description:
			"Any XHR, fetch, image, font, script or stylesheet request that fails (network error or status 400+) during load and interaction is reported with the request URL as the subject.",
		recommended: "error",
		implemented: true,
		fix: "Fix the endpoint or asset path, or remove the request. Third-party failures can be excluded via `ignore` on network/console-errors if they only surface as console noise.",
	},
	{
		id: "network/console-errors",
		summary: "The browser console must stay free of errors.",
		description:
			"`console.error` calls and uncaught exceptions during load and interaction are reported. Messages matching an `ignore` pattern (substring or regular expression) are skipped.",
		options: {
			schema: Type.Object(
				{
					ignore: stringList("Substrings or regular expressions of messages to ignore.", [
						"ResizeObserver loop",
					]),
				},
				{ additionalProperties: false },
			),
			defaults: { ignore: ["ResizeObserver loop"] },
		},
		recommended: ["error", { ignore: ["ResizeObserver loop"] }],
		implemented: true,
		fix: "Fix the source of the error. Add known-benign third-party messages to `ignore`.",
	},
	{
		id: "network/console-warnings",
		summary: "The browser console must stay free of warnings.",
		description:
			"`console.warn` calls during load and interaction are reported. Noisy by default, so it is off.",
		recommended: "off",
		implemented: true,
		fix: "Address the warning or turn the rule off for the route.",
	},
	{
		id: "network/large-assets",
		summary: "No single asset may exceed `maxKb`.",
		description:
			"Transfer size of every response is measured; anything over the limit is reported with its URL.",
		options: {
			schema: Type.Object(
				{
					maxKb: Type.Number({
						description: "Maximum transfer size per asset in kilobytes.",
						minimum: 1,
						default: 500,
					}),
				},
				{ additionalProperties: false },
			),
			defaults: { maxKb: 500 },
		},
		recommended: ["warn", { maxKb: 500 }],
		implemented: true,
		fix: "Compress or resize the asset, split the bundle, or lazy-load it.",
	},
	{
		id: "network/request-count",
		summary: "A route may not issue more than `max` requests on load.",
		description: "Counts every request made until the page is idle.",
		options: {
			schema: Type.Object(
				{
					max: Type.Integer({
						description: "Maximum number of requests during page load.",
						minimum: 1,
						default: 100,
					}),
				},
				{ additionalProperties: false },
			),
			defaults: { max: 100 },
		},
		recommended: ["warn", { max: 100 }],
		implemented: true,
		fix: "Bundle assets, use sprites or inline small resources, remove unused third-party scripts.",
	},
	// ------------------------------------------------------------------ seo
	{
		id: "seo/title",
		summary: "Every page needs a `<title>` within the configured length.",
		description: "A missing, empty, too short or too long document title is reported.",
		options: {
			schema: Type.Object(
				{
					min: Type.Integer({ description: "Minimum title length in characters.", minimum: 0, default: 10 }),
					max: Type.Integer({ description: "Maximum title length in characters.", minimum: 1, default: 60 }),
				},
				{ additionalProperties: false },
			),
			defaults: { min: 10, max: 60 },
		},
		recommended: ["error", { min: 10, max: 60 }],
		implemented: true,
		fix: "Set a descriptive <title> per route, typically `Page name – Site name`.",
	},
	{
		id: "seo/duplicate-title",
		summary: "Titles must be unique across routes.",
		description:
			"Two or more audited routes share the same `<title>`. Search engines and tab bars cannot tell them apart.",
		recommended: "warn",
		implemented: true,
		fix: "Include the page-specific subject in each title.",
	},
	{
		id: "seo/meta-description",
		summary: "Every page needs a meta description within the configured length.",
		description: 'A missing, empty, too short or too long `<meta name="description">` is reported.',
		options: {
			schema: Type.Object(
				{
					min: Type.Integer({ description: "Minimum length in characters.", minimum: 0, default: 50 }),
					max: Type.Integer({ description: "Maximum length in characters.", minimum: 1, default: 160 }),
				},
				{ additionalProperties: false },
			),
			defaults: { min: 50, max: 160 },
		},
		recommended: ["warn", { min: 50, max: 160 }],
		implemented: true,
		fix: "Add a one-sentence description of the page in the document head.",
	},
	{
		id: "seo/single-h1",
		summary: "Exactly one `<h1>` per page.",
		description:
			"Zero or multiple `<h1>` elements are reported. One top-level heading tells crawlers and screen readers what the page is about.",
		recommended: "error",
		implemented: true,
		fix: "Keep one `<h1>` for the page subject; demote the others to `<h2>`.",
		examples: { bad: "<h1>Shop</h1> ... <h1>Featured</h1>", good: "<h1>Shop</h1> ... <h2>Featured</h2>" },
	},
	{
		id: "seo/heading-order",
		summary: "Heading levels must not skip.",
		description:
			"An `<h4>` directly after an `<h2>` (and similar jumps) is reported. Heading order is the page outline for assistive technology.",
		recommended: "warn",
		implemented: true,
		fix: "Use the next heading level down; style with CSS, not by picking a smaller heading tag.",
	},
	{
		id: "seo/canonical",
		summary: "Pages need a valid canonical link.",
		description:
			'Reports a missing `<link rel="canonical">`, a relative or malformed href, or a canonical pointing at a different route than expected.',
		recommended: "warn",
		implemented: true,
		fix: "Emit an absolute canonical URL for each route.",
	},
	{
		id: "seo/robots-noindex",
		summary: "Public routes must not be marked noindex.",
		description:
			'A `<meta name="robots" content="noindex">` or `X-Robots-Tag: noindex` on a route not covered by `allow` is reported. Catches staging flags shipped to production.',
		options: {
			schema: Type.Object(
				{ allow: stringList("Route globs where noindex is intentional.", ["/admin/**", "/preview/**"]) },
				{ additionalProperties: false },
			),
			defaults: { allow: ["/admin/**", "/preview/**"] },
		},
		recommended: ["error", { allow: ["/admin/**", "/preview/**"] }],
		implemented: true,
		fix: "Remove the noindex directive, or add the route to `allow` if it is intentionally hidden.",
	},
	{
		id: "seo/robots-txt",
		summary: "robots.txt must exist and parse.",
		description:
			"Requests `/robots.txt`; reports a missing file, a non-text response, unparsable directives, or a blanket `Disallow: /` for all agents.",
		recommended: "warn",
		implemented: true,
		fix: "Serve a robots.txt that allows crawling of public routes and lists the sitemap.",
	},
	{
		id: "seo/sitemap",
		summary: "sitemap.xml must exist, be valid and cover the discovered routes.",
		description:
			"Loads the sitemap referenced by robots.txt or `/sitemap.xml`, validates the XML, and reports public routes that are missing from it.",
		recommended: "warn",
		implemented: true,
		fix: "Generate the sitemap from the router at build time so it cannot drift.",
	},
	{
		id: "seo/lang-attribute",
		summary: "`<html>` must declare a language.",
		description:
			"A missing or invalid `lang` attribute on the root element is reported. Screen readers use it to pick a voice and search engines to pick a market.",
		recommended: "error",
		implemented: true,
		fix: 'Set <html lang="en"> (or the page language, as a BCP 47 tag).',
	},
	{
		id: "seo/open-graph",
		summary: "Pages need Open Graph title, description and image.",
		description:
			"Reports missing `og:title`, `og:description` or `og:image`, and an `og:image` that does not load.",
		recommended: "warn",
		implemented: true,
		fix: "Add the og:* meta tags; share previews on chat apps and social sites depend on them.",
	},
	{
		id: "seo/twitter-card",
		summary: "Pages need Twitter card meta tags.",
		description:
			"Reports a missing `twitter:card`. Off by default because Open Graph tags are usually enough.",
		recommended: "off",
		implemented: true,
		fix: 'Add <meta name="twitter:card" content="summary_large_image"> and matching title/description/image tags.',
	},
	{
		id: "seo/structured-data",
		summary: "JSON-LD blocks must parse and use known types.",
		description:
			'Every `<script type="application/ld+json">` is parsed. Invalid JSON, a missing `@context`/`@type`, or an unknown schema.org type is reported.',
		recommended: "warn",
		implemented: true,
		fix: "Validate the JSON-LD with the schema.org validator and fix the offending block.",
	},
	{
		id: "seo/hreflang",
		summary: "Localized pages must declare hreflang alternates.",
		description:
			'For multi-language sites, reports missing or non-reciprocal `<link rel="alternate" hreflang>` entries. Off by default.',
		recommended: "off",
		implemented: true,
		fix: "Emit a full set of hreflang links, including `x-default`, on every localized page.",
	},
	{
		id: "seo/url-format",
		summary: "URLs must be lowercase and use a consistent trailing slash.",
		description:
			"Reports discovered internal URLs with uppercase characters (when `lowercase` is true) and inconsistent trailing slashes across routes.",
		options: {
			schema: Type.Object(
				{
					lowercase: Type.Boolean({ description: "Require lowercase paths.", default: true }),
					trailingSlash: Type.Union(
						[
							Type.Literal("consistent"),
							Type.Literal("always"),
							Type.Literal("never"),
							Type.Literal("ignore"),
						],
						{ description: "Trailing slash policy.", default: "consistent" },
					),
				},
				{ additionalProperties: false },
			),
			defaults: { lowercase: true, trailingSlash: "consistent" },
		},
		recommended: ["warn", { lowercase: true, trailingSlash: "consistent" }],
		implemented: true,
		fix: "Normalize URLs in the router and redirect the other form.",
	},
	// ----------------------------------------------------------------- a11y
	{
		id: "a11y/axe",
		summary: "axe-core must report no violations of the configured impact and tags.",
		description:
			"Runs axe-core on each route and viewport. Violations whose impact is in `impact` and whose tags intersect `tags` are reported one per rule and selector. Rule ids in `disable` are skipped.",
		options: {
			schema: Type.Object(
				{
					impact: Type.Array(
						Type.Union([
							Type.Literal("minor"),
							Type.Literal("moderate"),
							Type.Literal("serious"),
							Type.Literal("critical"),
						]),
						{ description: "axe impact levels that produce findings.", default: ["critical", "serious"] },
					),
					tags: stringList("axe tags to run, e.g. wcag2a, wcag2aa, best-practice.", ["wcag2a", "wcag2aa"]),
					disable: stringList("axe rule ids to skip.", []),
				},
				{ additionalProperties: false },
			),
			defaults: { impact: ["critical", "serious"], tags: ["wcag2a", "wcag2aa"], disable: [] },
		},
		recommended: ["error", { impact: ["critical", "serious"], tags: ["wcag2a", "wcag2aa"], disable: [] }],
		implemented: true,
		fix: "Follow the axe help link in the finding; each violation names the failing element.",
	},
	{
		id: "a11y/img-alt",
		summary: "Images need alt text.",
		description:
			'Mapped from axe `image-alt`. Reports <img> elements without an `alt` attribute. Decorative images must use `alt=""`.',
		recommended: "error",
		implemented: true,
		fix: 'Describe the image in `alt`, or set alt="" for purely decorative images.',
		examples: {
			bad: '<img src="/hero.png">',
			good: '<img src="/hero.png" alt="A gribble boring into a plank">',
		},
	},
	{
		id: "a11y/form-labels",
		summary: "Form controls need labels.",
		description:
			"Mapped from axe `label`. Reports inputs, selects and textareas without a <label>, `aria-label` or `aria-labelledby`.",
		recommended: "error",
		implemented: true,
		fix: "Add a <label for> that points at the control, or an aria-label.",
	},
	{
		id: "a11y/accessible-name",
		summary: "Buttons and links need an accessible name.",
		description:
			"Mapped from axe `button-name` and `link-name`. Icon-only controls without text, `aria-label` or a labelled image are reported.",
		recommended: "error",
		implemented: true,
		fix: "Add visible text, an aria-label, or alt text on the icon image.",
	},
	{
		id: "a11y/color-contrast",
		summary: "Text must meet the WCAG contrast ratio for `level`.",
		description:
			"Reports text whose contrast against its background is below 4.5:1 (AA) or 7:1 (AAA); large text uses the lower thresholds.",
		options: {
			schema: Type.Object(
				{
					level: Type.Union([Type.Literal("AA"), Type.Literal("AAA")], {
						description: "WCAG conformance level.",
						default: "AA",
					}),
				},
				{ additionalProperties: false },
			),
			defaults: { level: "AA" },
		},
		recommended: ["warn", { level: "AA" }],
		implemented: true,
		fix: "Darken the text or lighten the background until the ratio passes.",
	},
	{
		id: "a11y/focus-visible",
		summary: "Focused elements must be visibly focused.",
		description:
			"Tabs through interactive elements and reports those whose computed style does not change on focus (outline removed with no replacement).",
		recommended: "warn",
		implemented: false,
		fix: "Do not remove `outline` without providing a `:focus-visible` style.",
	},
	{
		id: "a11y/keyboard-reachable",
		summary: "Every interactive element must be reachable with Tab.",
		description:
			"Compares the set of clickable elements with the set reached by tabbing through the page; elements that are only mouse-reachable are reported.",
		recommended: "warn",
		implemented: false,
		fix: 'Use native buttons and links, or add tabindex="0" and key handlers to custom controls.',
	},
	{
		id: "a11y/touch-target",
		summary: "Interactive elements must be at least `minPx` square on mobile.",
		description:
			"Measures bounding boxes of interactive elements in the mobile viewport; anything smaller than `minPx` in either dimension is reported.",
		options: {
			schema: Type.Object(
				{
					minPx: Type.Number({
						description: "Minimum width and height in CSS pixels.",
						minimum: 1,
						default: 44,
					}),
				},
				{ additionalProperties: false },
			),
			defaults: { minPx: 44 },
		},
		recommended: ["warn", { minPx: 44 }],
		implemented: true,
		fix: "Increase padding or min-height/min-width on the control.",
	},
	{
		id: "a11y/skip-link",
		summary: "Pages need a skip-to-content link.",
		description:
			"Reports pages whose first focusable element is not a link to the main content. Off by default.",
		recommended: "off",
		implemented: false,
		fix: 'Add <a href="#main" class="skip-link">Skip to content</a> as the first element in `<body>`.',
	},
	{
		id: "a11y/reduced-motion",
		summary: "Animations must respect prefers-reduced-motion.",
		description:
			"Reports CSS animations and transitions longer than a threshold that still run under `prefers-reduced-motion: reduce`. Off by default.",
		recommended: "off",
		implemented: false,
		fix: "Wrap animations in `@media (prefers-reduced-motion: no-preference)`.",
	},
	// ----------------------------------------------------------------- perf
	{
		id: "perf/lighthouse-performance",
		summary: "Lighthouse performance score must be at least `min`.",
		description:
			"Runs Lighthouse per route and viewport and compares the performance category score (0-100) with `min`.",
		options: {
			schema: Type.Object(
				{
					min: Type.Number({
						description: "Minimum performance score (0-100).",
						minimum: 0,
						maximum: 100,
						default: 80,
					}),
				},
				{ additionalProperties: false },
			),
			defaults: { min: 80 },
		},
		recommended: ["warn", { min: 80 }],
		implemented: true,
		fix: "Open the Lighthouse report attached to the run and work through the opportunities list.",
	},
	{
		id: "perf/lcp",
		summary: "Largest Contentful Paint must be under `maxMs`.",
		description: "Measured by Lighthouse under simulated throttling.",
		options: {
			schema: Type.Object(
				{ maxMs: Type.Number({ description: "Maximum LCP in milliseconds.", minimum: 0, default: 2500 }) },
				{ additionalProperties: false },
			),
			defaults: { maxMs: 2500 },
		},
		recommended: ["error", { maxMs: 2500 }],
		implemented: true,
		fix: "Preload the LCP image or font, inline critical CSS, remove render-blocking scripts.",
	},
	{
		id: "perf/cls",
		summary: "Cumulative Layout Shift must be under `max`.",
		description:
			"Measured by Lighthouse. Layout shifts usually come from images without dimensions, late-loading fonts and injected banners.",
		options: {
			schema: Type.Object(
				{ max: Type.Number({ description: "Maximum CLS score.", minimum: 0, default: 0.1 }) },
				{ additionalProperties: false },
			),
			defaults: { max: 0.1 },
		},
		recommended: ["error", { max: 0.1 }],
		implemented: true,
		fix: "Give images and embeds explicit dimensions, reserve space for late content, use font-display: optional or swap with size-adjust.",
	},
	{
		id: "perf/tbt",
		summary: "Total Blocking Time must be under `maxMs`.",
		description: "Measured by Lighthouse. Long tasks on the main thread block input.",
		options: {
			schema: Type.Object(
				{ maxMs: Type.Number({ description: "Maximum TBT in milliseconds.", minimum: 0, default: 200 }) },
				{ additionalProperties: false },
			),
			defaults: { maxMs: 200 },
		},
		recommended: ["warn", { maxMs: 200 }],
		implemented: true,
		fix: "Split long tasks, defer non-critical JavaScript, reduce hydration work.",
	},
	{
		id: "perf/page-weight",
		summary: "Total transfer size of a route must be under `maxKb`.",
		description: "Sums the transfer size of every request made during load.",
		options: {
			schema: Type.Object(
				{
					maxKb: Type.Number({
						description: "Maximum total transfer size in kilobytes.",
						minimum: 1,
						default: 2000,
					}),
				},
				{ additionalProperties: false },
			),
			defaults: { maxKb: 2000 },
		},
		recommended: ["warn", { maxKb: 2000 }],
		implemented: true,
		fix: "Compress images, tree-shake bundles, lazy-load below-the-fold content.",
	},
	{
		id: "perf/unsized-images",
		summary: "Images need explicit width and height.",
		description:
			"Reports <img> elements without `width`/`height` attributes or CSS aspect-ratio; they cause layout shift.",
		recommended: "warn",
		implemented: true,
		fix: "Add width and height attributes (or aspect-ratio in CSS) to every image.",
	},
	{
		id: "perf/image-format",
		summary: "Images should use a modern format.",
		description: "Reports large JPEG/PNG images that would be smaller as WebP or AVIF.",
		recommended: "warn",
		implemented: true,
		fix: "Serve WebP/AVIF via `<picture>` or an image CDN.",
	},
	{
		id: "perf/render-blocking",
		summary: "No render-blocking scripts or styles.",
		description:
			"Reports synchronous scripts and stylesheets in `<head>` that delay first paint. Off by default.",
		recommended: "off",
		implemented: true,
		fix: "Add defer/async to scripts, inline critical CSS, preload the rest.",
	},
	{
		id: "perf/regression",
		summary: "Metrics must not regress against the baseline by more than the thresholds.",
		description:
			"Compares each route's Lighthouse score, LCP, CLS and page weight with `baseline/metrics.json`. A drop larger than the configured delta is reported. Skipped when there is no baseline for the route.",
		options: {
			schema: Type.Object(
				{
					score: Type.Number({
						description: "Allowed Lighthouse score delta (negative means a drop).",
						default: -5,
					}),
					lcpMs: Type.Number({
						description: "Allowed LCP increase in milliseconds.",
						minimum: 0,
						default: 500,
					}),
					cls: Type.Number({ description: "Allowed CLS increase.", minimum: 0, default: 0.05 }),
					weightKb: Type.Number({
						description: "Allowed page weight increase in kilobytes.",
						minimum: 0,
						default: 300,
					}),
				},
				{ additionalProperties: false },
			),
			defaults: { score: -5, lcpMs: 500, cls: 0.05, weightKb: 300 },
		},
		recommended: ["warn", { score: -5, lcpMs: 500, cls: 0.05, weightKb: 300 }],
		implemented: true,
		fix: "Compare the route against the baseline run and find the change that added weight or blocking time.",
	},
	// ------------------------------------------------------------------- ui
	{
		id: "ui/colors-from-tokens",
		summary: "Computed colors must come from the design tokens.",
		description:
			"Collects computed `color`, `background-color` and `border-color` values and compares them with the token set (`auto` reads tailwind.config and CSS custom properties). Values not in the set are reported with their selector.",
		options: {
			schema: Type.Object(
				{
					tokens: Type.Union([Type.Literal("auto"), Type.Array(Type.String())], {
						description: "`auto` to read tokens from the project, or an explicit list of allowed colors.",
						default: "auto",
					}),
				},
				{ additionalProperties: false },
			),
			defaults: { tokens: "auto" },
		},
		recommended: ["warn", { tokens: "auto" }],
		implemented: true,
		fix: "Replace the hardcoded color with the closest token.",
	},
	{
		id: "ui/font-sizes-from-tokens",
		summary: "Font sizes must come from the type scale.",
		description: "Compares computed font sizes with the sizes defined in the project's tokens.",
		recommended: "warn",
		implemented: true,
		fix: "Use a size from the type scale instead of an arbitrary value.",
	},
	{
		id: "ui/spacing-from-tokens",
		summary: "Margins and paddings must come from the spacing scale.",
		description:
			"Compares computed margin and padding values with the project's spacing tokens. Off by default because it is noisy.",
		recommended: "off",
		implemented: false,
		fix: "Use a spacing token.",
	},
	{
		id: "ui/min-font-size",
		summary: "Text must be at least `px` pixels.",
		description: "Reports visible text with a computed font size below the threshold.",
		options: {
			schema: Type.Object(
				{ px: Type.Number({ description: "Minimum font size in CSS pixels.", minimum: 1, default: 12 }) },
				{ additionalProperties: false },
			),
			defaults: { px: 12 },
		},
		recommended: ["warn", { px: 12 }],
		implemented: true,
		fix: "Increase the font size; 12px is the floor for body copy on most platforms.",
	},
	{
		id: "ui/overlap",
		summary: "Interactive elements must not overlap.",
		description:
			"Compares bounding boxes of interactive elements; overlapping pairs that are both visible are reported.",
		recommended: "error",
		implemented: true,
		fix: "Fix the layout so that the elements do not share screen area.",
	},
	{
		id: "ui/horizontal-overflow",
		summary: "Pages must not scroll horizontally in the listed viewports.",
		description:
			"Reports routes whose document width exceeds the viewport width, together with the widest offending element.",
		options: {
			schema: Type.Object(
				{ viewports: stringList("Viewport names (from gribble.yaml) to check.", ["mobile"]) },
				{ additionalProperties: false },
			),
			defaults: { viewports: ["mobile"] },
		},
		recommended: ["error", { viewports: ["mobile"] }],
		implemented: true,
		fix: "Constrain the offending element with max-width: 100% or overflow-x: hidden on the container.",
	},
	{
		id: "ui/text-clipped",
		summary: "Text must not be clipped or overflow its container.",
		description:
			"Reports elements whose scroll size exceeds their client size with overflow hidden and no text-overflow handling.",
		recommended: "warn",
		implemented: true,
		fix: "Let the container grow, wrap the text, or use text-overflow: ellipsis deliberately.",
	},
	{
		id: "ui/broken-images",
		summary: "Images must load and have a non-zero natural size.",
		description: "Reports <img> elements whose `naturalWidth` is 0 after load.",
		recommended: "error",
		implemented: true,
		fix: "Fix the image path or the asset pipeline.",
	},
	{
		id: "ui/placeholder-text",
		summary: "No placeholder text may ship.",
		description:
			"Reports visible text matching any of the `patterns` (case-insensitive substrings or regular expressions).",
		options: {
			schema: Type.Object(
				{
					patterns: stringList("Substrings or regular expressions that identify placeholder copy.", [
						"lorem ipsum",
						"TODO",
						"FIXME",
						"placeholder",
					]),
				},
				{ additionalProperties: false },
			),
			defaults: { patterns: ["lorem ipsum", "TODO", "FIXME", "placeholder"] },
		},
		recommended: ["error", { patterns: ["lorem ipsum", "TODO", "FIXME", "placeholder"] }],
		implemented: true,
		fix: "Replace the placeholder with real copy.",
	},
	{
		id: "ui/favicon",
		summary: "The site needs a favicon.",
		description: 'Reports a missing or non-loading `<link rel="icon">` (and `/favicon.ico` fallback).',
		recommended: "warn",
		implemented: true,
		fix: "Add a favicon link in the document head and ship the file.",
	},
	{
		id: "ui/empty-state",
		summary: "Lists and tables with zero rows need an empty state.",
		description:
			"Reports list and table containers that render no rows and no explanatory text. Off by default.",
		recommended: "off",
		implemented: false,
		fix: "Render a short empty-state message with a next step.",
	},
	{
		id: "visual/regression",
		summary: "Screenshots must not differ from the baseline by more than `threshold`.",
		description:
			"Compares a screenshot per route and viewport with `baseline/screenshots/` using pixel diffing. The ratio of changed pixels above `threshold` is reported with the diff image as evidence. Skipped when the baseline has no screenshot for the route.",
		options: {
			schema: Type.Object(
				{
					threshold: Type.Number({
						description: "Maximum ratio of changed pixels (0-1).",
						minimum: 0,
						maximum: 1,
						default: 0.01,
					}),
					viewports: stringList("Viewport names to compare.", ["mobile", "desktop"]),
				},
				{ additionalProperties: false },
			),
			defaults: { threshold: 0.01, viewports: ["mobile", "desktop"] },
		},
		recommended: "off",
		implemented: true,
		fix: "Review the diff image. If the change is intended, update the baseline. Off in `gribble:recommended`: opt in with `visual/regression: warn` plus `baseline.screenshots: commit` (or `lfs`), because screenshots are binary churn in git and differ across rendering platforms.",
	},
	{
		id: "structure/regression",
		summary: "Landmarks, navigation and forms must not disappear compared with the baseline.",
		description:
			"Diffs the aria snapshot of each route against `baseline/snapshots/`. A removed navigation item, form, landmark or heading is reported. Additions are not.",
		recommended: "warn",
		implemented: true,
		fix: "Restore the removed element, or update the baseline if the removal is intended.",
	},
	// ----------------------------------------------------------------- html
	{
		id: "html/doctype",
		summary: "Documents must start with <!DOCTYPE html>.",
		description: "A missing or non-HTML5 doctype puts the browser in quirks mode.",
		recommended: "error",
		implemented: true,
		fix: "Add <!DOCTYPE html> as the first line of the document.",
	},
	{
		id: "html/charset",
		summary: "Documents must declare a UTF-8 charset.",
		description:
			"Reports a missing `<meta charset>` or a charset other than UTF-8, and a charset declared after the first 1024 bytes.",
		recommended: "error",
		implemented: true,
		fix: 'Put <meta charset="utf-8"> first in `<head>`.',
	},
	{
		id: "html/viewport-meta",
		summary: "Documents need a viewport meta tag.",
		description: 'Without `<meta name="viewport">` mobile browsers render the desktop layout and zoom out.',
		recommended: "error",
		implemented: true,
		fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
		examples: { good: '<meta name="viewport" content="width=device-width, initial-scale=1">' },
	},
	{
		id: "html/duplicate-ids",
		summary: "Element ids must be unique.",
		description:
			"Reports id values used more than once in a document; duplicates break labels, anchors and ARIA references.",
		recommended: "error",
		implemented: true,
		fix: "Rename one of the elements, or generate ids per instance in the component.",
		examples: {
			bad: '<input id="email"> ... <input id="email">',
			good: '<input id="login-email"> ... <input id="newsletter-email">',
		},
	},
	{
		id: "html/deprecated-elements",
		summary: "No deprecated HTML elements.",
		description: "Reports `<center>`, `<font>`, `<marquee>`, `<frame>` and other obsolete elements.",
		recommended: "warn",
		implemented: false,
		fix: "Replace the element with semantic HTML and CSS.",
	},
	{
		id: "html/valid",
		summary: "Markup must validate.",
		description:
			"Runs an HTML validator on each document. Noisy on most real sites, so it is off by default; `ignore` takes validator message patterns.",
		options: {
			schema: Type.Object(
				{ ignore: stringList("Validator message patterns to ignore.", []) },
				{ additionalProperties: false },
			),
			defaults: { ignore: [] },
		},
		recommended: ["off", { ignore: [] }],
		implemented: false,
		fix: "Fix the reported markup errors.",
	},
	// ------------------------------------------------------------- security
	{
		id: "security/https-only",
		summary: "Non-local targets must be served over HTTPS.",
		description:
			"Reports an `http://` target URL or a redirect to http. Localhost and loopback addresses are exempt.",
		recommended: "error",
		implemented: true,
		fix: "Serve the site over HTTPS and redirect http to https.",
	},
	{
		id: "security/mixed-content",
		summary: "HTTPS pages must not load http resources.",
		description: "Reports subresources requested over http from an https document.",
		recommended: "error",
		implemented: true,
		fix: "Use https or protocol-relative URLs for every subresource.",
	},
	{
		id: "security/headers",
		summary: "Responses must include the required security headers.",
		description: "Checks the document response for each header listed in `require`.",
		options: {
			schema: Type.Object(
				{
					require: stringList("Lowercase header names that must be present.", [
						"content-security-policy",
						"x-content-type-options",
						"strict-transport-security",
					]),
				},
				{ additionalProperties: false },
			),
			defaults: {
				require: ["content-security-policy", "x-content-type-options", "strict-transport-security"],
			},
		},
		recommended: [
			"warn",
			{ require: ["content-security-policy", "x-content-type-options", "strict-transport-security"] },
		],
		implemented: true,
		fix: "Set the headers in the server or hosting configuration.",
	},
	{
		id: "security/exposed-secrets",
		summary: "No API keys or tokens in shipped HTML and JavaScript.",
		description:
			"Scans document and script responses for known secret formats (cloud provider keys, private keys, bearer tokens). A match is reported with the asset URL; the secret value itself is redacted in the finding.",
		recommended: "critical",
		implemented: true,
		fix: "Rotate the secret immediately, then move it to the server side.",
	},
	{
		id: "security/sourcemaps-exposed",
		summary: "Production builds must not expose source maps.",
		description: "Reports `//# sourceMappingURL` comments whose map file is publicly reachable.",
		recommended: "warn",
		implemented: true,
		fix: "Disable source map emission for production, or restrict access to the .map files.",
	},
	{
		id: "security/form-without-csrf",
		summary: "State-changing forms need CSRF protection.",
		description:
			"Reports POST forms without a hidden token field or a same-site cookie policy. Off by default because frameworks differ.",
		recommended: "off",
		implemented: false,
		fix: "Add a CSRF token to the form or rely on SameSite cookies plus origin checks.",
	},
	// ----------------------------------------------------------------- i18n
	{
		id: "i18n/untranslated-keys",
		summary: "Raw translation keys must not leak into the UI.",
		description:
			"Reports visible text matching any of the `patterns`, which by default catches dotted keys such as `home.hero.title`.",
		options: {
			schema: Type.Object(
				{
					patterns: stringList("Regular expressions that identify translation keys.", [
						"^[a-z]+(\\.[a-z_]+)+$",
					]),
				},
				{ additionalProperties: false },
			),
			defaults: { patterns: ["^[a-z]+(\\.[a-z_]+)+$"] },
		},
		recommended: ["warn", { patterns: ["^[a-z]+(\\.[a-z_]+)+$"] }],
		implemented: true,
		fix: "Add the missing translation, or fix the key.",
	},
	{
		id: "i18n/mixed-language",
		summary: "A page must not mix languages.",
		description:
			"Detects the language of text blocks and reports pages with a significant share in a second language. Off by default.",
		recommended: "off",
		implemented: false,
		fix: "Translate the remaining strings.",
	},
	{
		id: "i18n/lang-mismatch",
		summary: "The declared html lang must match the content language.",
		description:
			"Compares the `lang` attribute with the detected language of the visible text. Off by default.",
		recommended: "off",
		implemented: false,
		fix: "Set `lang` to the language the page is actually written in.",
	},
	// ---------------------------------------------------------------- flows
	{
		id: "flows/replay",
		summary: "Recorded flows must replay without failing a step.",
		description:
			"Replays every `flows/<name>.replay.json` in gate mode. A failed step (element not found, expectation not met, timeout) is reported with the step index.",
		recommended: "critical",
		implemented: true,
		fix: "Open the flow, reproduce the failing step manually, then fix the site or re-record the flow.",
	},
	{
		id: "flows/max-duration",
		summary: "A flow must complete within `seconds`.",
		description: "Wall-clock time of a replayed flow.",
		options: {
			schema: Type.Object(
				{
					seconds: Type.Number({ description: "Maximum flow duration in seconds.", minimum: 1, default: 60 }),
				},
				{ additionalProperties: false },
			),
			defaults: { seconds: 60 },
		},
		recommended: ["warn", { seconds: 60 }],
		implemented: true,
		fix: "Find the slow step in the flow result and speed up that page or request.",
	},
	// --------------------------------------------------------------- review
	{
		id: "review/guidelines",
		summary: "Violations of guidelines.md found by the AI reviewer.",
		description:
			"The reviewer reads `.gribble/guidelines.md` and reports pages or components that contradict it. Severity caps every finding in this category.",
		recommended: "warn",
		deterministic: false,
		implemented: true,
		fix: "Apply the guideline, or refine the guideline text if it is ambiguous.",
	},
	{
		id: "review/ux",
		summary: "Confusing interactions and unclear states found by the AI reviewer.",
		description:
			"Unlabelled controls, ambiguous actions, missing feedback after an action, and similar usability problems.",
		recommended: "warn",
		deterministic: false,
		implemented: true,
		fix: "Follow the suggestion in the finding; verify with a manual walk-through.",
	},
	{
		id: "review/copy",
		summary: "Typos, tone and inconsistent terminology found by the AI reviewer.",
		description:
			"Spelling mistakes, inconsistent product names, and copy that clashes with the tone described in guidelines.md.",
		recommended: "warn",
		deterministic: false,
		implemented: true,
		fix: "Edit the copy as suggested.",
	},
	{
		id: "review/dead-ends",
		summary: "Pages with no way forward or back found by the AI reviewer.",
		description: "Routes without navigation, actions that lead nowhere, and error pages without a way home.",
		recommended: "warn",
		deterministic: false,
		implemented: true,
		fix: "Add navigation or a clear next action to the page.",
	},
	{
		id: "review/flow-coverage",
		summary: "Important flows that are not described in flows/.",
		description:
			"The reviewer explores the site and reports user journeys that have no matching `flows/*.md`.",
		recommended: "warn",
		deterministic: false,
		implemented: true,
		fix: "Write the flow as flows/`<name>`.md so that it is walked on every audit.",
	},
	{
		id: "review/error-handling",
		summary: "Missing error, empty and loading states found by the AI reviewer.",
		description:
			"Forms without validation messages, lists without empty states, and actions without loading feedback.",
		recommended: "warn",
		deterministic: false,
		implemented: true,
		fix: "Add the missing state and its copy.",
	},
];

function severityOf(setting: RuleSetting): Severity {
	return typeof setting === "string" ? setting : setting[0];
}

function withSeverity(setting: RuleSetting, severity: Severity): RuleSetting {
	return typeof setting === "string" ? severity : [severity, setting[1]];
}

function derivePresets(def: RuleDef): RuleMeta["presets"] {
	const category = ruleCategory(def.id);
	const recommended = def.recommended;
	const recommendedSeverity = severityOf(recommended);
	const strict =
		STRICT_PROMOTED_CATEGORIES.has(category) && recommendedSeverity === "warn"
			? withSeverity(recommended, "error")
			: recommended;
	const focused = (target: RuleCategory): RuleSetting =>
		category === target
			? recommendedSeverity === "off"
				? withSeverity(recommended, "warn")
				: recommended
			: "off";
	return { recommended, strict, seo: focused("seo"), a11y: focused("a11y") };
}

function toMeta(def: RuleDef): RuleMeta {
	return {
		id: def.id,
		category: ruleCategory(def.id),
		summary: def.summary,
		description: def.description,
		optionsSchema: def.options?.schema,
		defaultOptions: def.options?.defaults,
		presets: derivePresets(def),
		deterministic: def.deterministic ?? true,
		implemented: def.implemented,
		fix: def.fix,
		examples: def.examples,
		docsUrl: `${RULES_DOCS_BASE_URL}/${def.id}`,
	};
}

/** All rules, in the order of the rule id list. */
export const RULES: readonly RuleMeta[] = RULE_IDS.map((id) => {
	const def = defs.find((d) => d.id === id);
	if (!def) throw new Error(`Rule ${id} is listed in ids.ts but has no registry entry`);
	return toMeta(def);
});

const RULE_MAP = new Map(RULES.map((r) => [r.id, r]));

export function getRule(id: string): RuleMeta | undefined {
	return RULE_MAP.get(id as RuleId);
}

/** Rules grouped by category, in category order. */
export function rulesByCategory(): Array<{ category: RuleCategory; rules: RuleMeta[] }> {
	const groups = new Map<RuleCategory, RuleMeta[]>();
	for (const rule of RULES) {
		const list = groups.get(rule.category) ?? [];
		list.push(rule);
		groups.set(rule.category, list);
	}
	return [...groups.entries()].map(([category, rules]) => ({ category, rules }));
}
