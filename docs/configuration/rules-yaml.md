---
title: rules.yaml
description: ESLint-style rule configuration — extends, ignore, severities, options and per-route overrides.
order: 31
---

`.gribble/rules.yaml` is the file your team actually edits. It borrows ESLint's shape on purpose: if you have configured ESLint you already know how this works.

```yaml
# yaml-language-server: $schema=https://gribble.dev/schema/rules.json
extends:
  - gribble:recommended

ignore: []

rules:
  seo/meta-description: [warn, { min: 50, max: 160 }]
  perf/lcp: [error, { maxMs: 2500 }]
  seo/twitter-card: off

overrides:
  - routes: ["/admin/**"]
    rules:
      seo/*: off
```

Every rule id, its options and its defaults per preset are listed in the [rules reference](/docs/configuration/rules-reference), which is generated from the registry in the source and is therefore always current.

## Structure

### `extends`

A list of presets to start from, applied in order, each one layering over the last. Your own `rules` block layers over all of them.

```yaml
extends:
  - gribble:recommended
  - gribble:a11y
```

`gribble init` writes `gribble:recommended`.

### `ignore`

Finding [fingerprints](/docs/concepts/findings#fingerprints) to suppress. Usually appended by `gribble ignore <fp>` rather than typed by hand.

```yaml
ignore:
  - 9f2c1d4a7b3e0c58   # external link behind a paywall, verified manually 2025-03-02
  - 1b77e0c9ad4f2e31   # legacy admin table, rewrite tracked in #914
```

Always leave a comment. An unexplained hash is indistinguishable from a mistake, and six months from now nobody will dare delete it.

### `rules`

A map of rule id to either a severity or a `[severity, options]` pair.

```yaml
rules:
  links/broken: error
  links/broken-external: [warn, { timeout: 10000, ignore: ["linkedin.com"] }]
  network/console-warnings: off
```

Options are merged over the rule's defaults, so you only write what differs. Wildcards work here as well as in overrides:

```yaml
rules:
  i18n/*: off
```

More specific keys win over wildcards regardless of order, so `i18n/*: off` plus `i18n/untranslated-keys: warn` leaves exactly that one rule on.

### `overrides`

Per-route adjustments, applied after everything else. Later entries win over earlier ones.

```yaml
overrides:
  - routes: ["/admin/**", "/internal/**"]
    rules:
      seo/*: off
      perf/lighthouse-performance: off

  - routes: ["/blog/**"]
    rules:
      seo/meta-description: error
      seo/open-graph: error
```

`routes` are glob patterns matched against the normalized route: `*` matches within a segment, `**` crosses segments. Patterns are matched against the pattern form of dynamic routes too, so `/blog/**` covers `/blog/[slug]`.

Nobody needs Open Graph tags on an internal admin dashboard, and everybody needs them on a blog post. This is where that lives.

## Severity semantics

There are five values, and no implicit escalation anywhere. A rule set to `warn` produces `warn` findings, always.

| Severity | Meaning | Gate | PR comment |
| --- | --- | --- | --- |
| `critical` | The site is broken | **fail** | yes |
| `error` | User-visible defect | **fail** | yes |
| `warn` | Quality regression | pass | yes |
| `info` | Suggestion | pass | no, report only |
| `off` | Rule disabled | — | — |

The boundary between gate and review is **just severity**. There is no separate "which mode does this rule belong to" setting: set a rule to `error` and it can block a merge, set it to `warn` and it comments. That is the whole mechanism.

Two things qualify it:

- Only **new** findings can fail the gate. Findings already in the [baseline](/docs/concepts/baseline) are counted, never blocking.
- AI findings are capped by their matching `review/*` rule severity, which defaults to `warn`. See [Findings](/docs/concepts/findings#ai-severity-capping-and-the-confidence-floor).

## The four presets

### `gribble:recommended`

The default, and what `gribble init` writes. It aims at "a reasonable team would agree this is a bug": broken internal links are `error`, a route that 5xxs is `critical`, serious and critical axe violations are `error`, missing alt text and unlabelled form fields are `error`, LCP and CLS have `error` thresholds, placeholder text shipped to production is `error`, exposed secrets are `critical`, flow replay failures are `critical`.

Softer things are `warn`: external link problems, meta description length, heading order, canonical, colour contrast, touch target size, Lighthouse score, page weight, design-token deviations, and every `review/*` rule. Genuinely subjective or noisy rules — `seo/twitter-card`, `a11y/skip-link`, `html/valid`, `security/form-without-csrf`, `ui/spacing-from-tokens`, `i18n/mixed-language` — ship `off`.

The expanded form is printed in full below.

### `gribble:strict`

Recommended with the dial turned up. Most `warn` rules become `error`, several rules that are `off` in recommended come on, and thresholds tighten — stricter perf budgets, contrast at the higher level, HTML validation enabled, security headers required. Use it on a new project where the cost of staying clean is low, or on a marketing site where quality is the product. Applying it to an established codebase will produce a very large first baseline, which is fine, but expect it.

### `gribble:seo`

A focused overlay: everything under `seo/*` on and turned up, plus the parts of `perf/*` and `html/*` that affect crawling and indexing. Accessibility and UI rules are left where they are. Meant to be combined, not used alone:

```yaml
extends:
  - gribble:recommended
  - gribble:seo
```

### `gribble:a11y`

The accessibility overlay. Widens the axe run to more tag sets and impact levels, and promotes contrast, focus visibility, keyboard reachability and touch target size from `warn` to `error`. Reach for it when you have a WCAG commitment to meet rather than a general quality bar.

Presets are data, not magic. A preset is just a map of rule id to setting, layered in order, and anything you write in your own `rules` block wins.

## Full example

This is `gribble:recommended` written out, which doubles as a tour of the rule catalogue. You never need to write this — `extends: [gribble:recommended]` is equivalent — but it is useful to see what you are getting.

```yaml
# yaml-language-server: $schema=https://gribble.dev/schema/rules.json
extends:
  - gribble:recommended

ignore: []                              # finding fingerprints, added via `gribble ignore <fp>`

rules:
  # --- Links & network ---
  links/broken: error                                   # internal 4xx/5xx
  links/broken-external: [warn, { timeout: 10000, ignore: ["linkedin.com"] }]
  links/redirect-chain: [warn, { max: 1 }]
  links/empty-href: warn                                # href="#" / javascript:void(0)
  links/target-blank-noopener: warn
  network/page-error: critical                          # route itself returns 5xx or crashes on render
  network/failed-requests: error                        # any failed XHR/fetch/asset
  network/console-errors: [error, { ignore: ["ResizeObserver loop"] }]
  network/console-warnings: off
  network/large-assets: [warn, { maxKb: 500 }]
  network/request-count: [warn, { max: 100 }]

  # --- SEO ---
  seo/title: [error, { min: 10, max: 60 }]
  seo/duplicate-title: warn
  seo/meta-description: [warn, { min: 50, max: 160 }]
  seo/single-h1: error
  seo/heading-order: warn                               # no skipped levels
  seo/canonical: warn
  seo/robots-noindex: [error, { allow: ["/admin/**", "/preview/**"] }]   # flags accidental noindex
  seo/robots-txt: warn
  seo/sitemap: warn                                     # exists, valid, covers discovered routes
  seo/lang-attribute: error
  seo/open-graph: warn
  seo/twitter-card: off
  seo/structured-data: warn                             # JSON-LD parses and validates
  seo/hreflang: off
  seo/url-format: [warn, { lowercase: true, trailingSlash: consistent }]

  # --- Accessibility ---
  a11y/axe: [error, { impact: [critical, serious], tags: [wcag2a, wcag2aa], disable: [] }]
  a11y/img-alt: error
  a11y/form-labels: error
  a11y/accessible-name: error                           # buttons/links with no name
  a11y/color-contrast: [warn, { level: AA }]
  a11y/focus-visible: warn
  a11y/keyboard-reachable: warn                         # every interactive element reachable via Tab
  a11y/touch-target: [warn, { minPx: 44 }]
  a11y/skip-link: off
  a11y/reduced-motion: off

  # --- Performance (Lighthouse + traces) ---
  perf/lighthouse-performance: [warn, { min: 80 }]
  perf/lcp: [error, { maxMs: 2500 }]
  perf/cls: [error, { max: 0.1 }]
  perf/tbt: [warn, { maxMs: 200 }]
  perf/page-weight: [warn, { maxKb: 2000 }]
  perf/unsized-images: warn                             # missing width/height -> CLS
  perf/image-format: warn                               # prefer webp/avif
  perf/render-blocking: off
  perf/regression: [warn, { score: -5, lcpMs: 500, cls: 0.05, weightKb: 300 }]   # vs baseline

  # --- UI hard rules (computed styles vs design tokens, layout math done in code) ---
  ui/colors-from-tokens: [warn, { tokens: auto }]       # auto = tailwind.config / CSS vars
  ui/font-sizes-from-tokens: warn
  ui/spacing-from-tokens: off
  ui/min-font-size: [warn, { px: 12 }]
  ui/overlap: error                                     # interactive elements overlapping
  ui/horizontal-overflow: [error, { viewports: [mobile] }]
  ui/text-clipped: warn
  ui/broken-images: error
  ui/placeholder-text: [error, { patterns: ["lorem ipsum", "TODO", "FIXME", "placeholder"] }]
  ui/favicon: warn
  ui/empty-state: off                                   # lists/tables rendering with zero rows
  visual/regression: [warn, { threshold: 0.01, viewports: [mobile, desktop] }]  # pixel diff vs baseline
  structure/regression: warn                            # aria snapshot diff vs baseline

  # --- HTML ---
  html/doctype: error
  html/charset: error
  html/viewport-meta: error
  html/duplicate-ids: error
  html/deprecated-elements: warn
  html/valid: [off, { ignore: [] }]                     # noisy by default

  # --- Security ---
  security/https-only: error
  security/mixed-content: error
  security/headers: [warn, { require: [content-security-policy, x-content-type-options, strict-transport-security] }]
  security/exposed-secrets: critical                    # API-key patterns in HTML/JS
  security/sourcemaps-exposed: warn
  security/form-without-csrf: off

  # --- i18n ---
  i18n/untranslated-keys: [warn, { patterns: ["^[a-z]+(\\.[a-z_]+)+$"] }]   # raw keys leaking into UI
  i18n/mixed-language: off
  i18n/lang-mismatch: off                               # html lang vs detected content language

  # --- Flows (replay of recorded steps) ---
  flows/replay: critical
  flows/max-duration: [warn, { seconds: 60 }]

  # --- Review (AI findings map to these severities; never block by default) ---
  review/guidelines: warn                               # violations of guidelines.md
  review/ux: warn                                       # confusing interactions, unclear states
  review/copy: warn                                     # typos, tone, inconsistent terminology
  review/dead-ends: warn                                # pages with no way back, broken navigation
  review/flow-coverage: warn                            # important flows not described in flows/
  review/error-handling: warn                           # missing error/empty/loading states

overrides:
  - routes: ["/admin/**", "/internal/**"]
    rules:
      seo/*: off
      perf/lighthouse-performance: off
  - routes: ["/blog/**"]
    rules:
      seo/meta-description: error
      seo/open-graph: error
```

## Not every rule is implemented yet

The registry contains the whole catalogue above, but the first release implements a subset. Rules that are registered but not yet implemented are marked in the [rules reference](/docs/configuration/rules-reference) and are silently inert — configuring one is valid YAML and costs you nothing, it just does not produce findings yet.

Implemented today: all of `links/*` and `network/*`, all of `seo/*`, `a11y/axe` with `img-alt`, `form-labels` and `accessible-name` derived from it, `perf/lighthouse-performance`, `perf/lcp`, `perf/cls`, `perf/tbt`, `perf/page-weight`, `perf/regression`, `ui/placeholder-text`, `visual/regression`, `structure/regression`, all of `html/doctype|charset|viewport-meta|duplicate-ids`, `security/https-only`, `security/mixed-content`, `security/exposed-secrets`, `i18n/untranslated-keys`, `flows/replay`, `flows/max-duration` and all of `review/*`.

## Explaining a rule

```bash
gribble explain a11y/touch-target
```

Prints the description, the option schema with defaults, its severity in each preset, a bad and a good example, and the fix hint — the same registry metadata that generates the reference page and the `docsUrl` on every finding.

## Cascading in a monorepo

`rules.yaml` files cascade from the repository root down to each app, child overriding parent. See [Monorepos](/docs/monorepos).

## Where a rule does not belong

- Something a model has to judge — "error messages should be friendly", "the tone should be restrained" — cannot be a rule. It goes in [`guidelines.md`](/docs/guidelines).
- Where the site is, which model to use, how much to spend — that is [`gribble.yaml`](/docs/configuration/gribble-yaml).
- One specific finding you do not care about is an `ignore` entry, not a disabled rule.
