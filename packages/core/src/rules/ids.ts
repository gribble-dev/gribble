/**
 * The single list of rule identifiers. Both the rules.yaml validator and the rule registry
 * derive from this file, so a rule cannot exist in one and not the other.
 */

export const RULE_CATEGORIES = [
	"links",
	"network",
	"seo",
	"a11y",
	"perf",
	"ui",
	"visual",
	"structure",
	"html",
	"security",
	"i18n",
	"flows",
	"review",
] as const;

export type RuleCategory = (typeof RULE_CATEGORIES)[number];

export const RULE_IDS = [
	// Links & network
	"links/broken",
	"links/broken-external",
	"links/redirect-chain",
	"links/empty-href",
	"links/target-blank-noopener",
	"network/page-error",
	"network/failed-requests",
	"network/console-errors",
	"network/console-warnings",
	"network/large-assets",
	"network/request-count",
	// SEO
	"seo/title",
	"seo/duplicate-title",
	"seo/meta-description",
	"seo/single-h1",
	"seo/heading-order",
	"seo/canonical",
	"seo/robots-noindex",
	"seo/robots-txt",
	"seo/sitemap",
	"seo/lang-attribute",
	"seo/open-graph",
	"seo/twitter-card",
	"seo/structured-data",
	"seo/hreflang",
	"seo/url-format",
	// Accessibility
	"a11y/axe",
	"a11y/img-alt",
	"a11y/form-labels",
	"a11y/accessible-name",
	"a11y/color-contrast",
	"a11y/focus-visible",
	"a11y/keyboard-reachable",
	"a11y/touch-target",
	"a11y/skip-link",
	"a11y/reduced-motion",
	// Performance
	"perf/lighthouse-performance",
	"perf/lcp",
	"perf/cls",
	"perf/tbt",
	"perf/page-weight",
	"perf/unsized-images",
	"perf/image-format",
	"perf/render-blocking",
	"perf/regression",
	// UI hard rules
	"ui/colors-from-tokens",
	"ui/font-sizes-from-tokens",
	"ui/spacing-from-tokens",
	"ui/min-font-size",
	"ui/overlap",
	"ui/horizontal-overflow",
	"ui/text-clipped",
	"ui/broken-images",
	"ui/placeholder-text",
	"ui/favicon",
	"ui/empty-state",
	"visual/regression",
	"structure/regression",
	// HTML
	"html/doctype",
	"html/charset",
	"html/viewport-meta",
	"html/duplicate-ids",
	"html/deprecated-elements",
	"html/valid",
	// Security
	"security/https-only",
	"security/mixed-content",
	"security/headers",
	"security/exposed-secrets",
	"security/sourcemaps-exposed",
	"security/form-without-csrf",
	// i18n
	"i18n/untranslated-keys",
	"i18n/mixed-language",
	"i18n/lang-mismatch",
	// Flows
	"flows/replay",
	"flows/max-duration",
	// Review (AI findings are mapped onto these)
	"review/guidelines",
	"review/ux",
	"review/copy",
	"review/dead-ends",
	"review/flow-coverage",
	"review/error-handling",
] as const;

export type RuleId = (typeof RULE_IDS)[number];

/** Wildcard keys accepted in rules.yaml, e.g. `seo/*`. */
export const RULE_WILDCARDS = RULE_CATEGORIES.map((c) => `${c}/*` as const);
export type RuleWildcard = (typeof RULE_WILDCARDS)[number];

const RULE_ID_SET: ReadonlySet<string> = new Set(RULE_IDS);
const WILDCARD_SET: ReadonlySet<string> = new Set(RULE_WILDCARDS);

export function isRuleId(value: string): value is RuleId {
	return RULE_ID_SET.has(value);
}

export function isRuleWildcard(value: string): value is RuleWildcard {
	return WILDCARD_SET.has(value);
}

/** True for a concrete rule id or a `category/*` wildcard. */
export function isRuleKey(value: string): boolean {
	return isRuleId(value) || isRuleWildcard(value);
}

/** The category part of a rule id or wildcard, e.g. `links/broken` -> `links`. */
export function ruleCategory(id: string): RuleCategory {
	return id.split("/")[0] as RuleCategory;
}

/** Concrete rule ids covered by a wildcard such as `seo/*`. */
export function expandRuleWildcard(wildcard: string): RuleId[] {
	const category = ruleCategory(wildcard);
	return RULE_IDS.filter((id) => id.startsWith(`${category}/`));
}
