---
title: Findings
description: What a finding contains, how its fingerprint is computed, how severity works, and how comments live and die.
order: 22
---

A finding is one problem on one route. It is the unit everything else is built on: the baseline is a list of them, PR comments are one per finding, SARIF results map one-to-one, and the gate verdict is a function of them.

## Anatomy

```json
{
  "fingerprint": "9f2c1d4a7b3e0c58",
  "rule": "links/broken",
  "severity": "error",
  "source": "deterministic",
  "status": "new",
  "title": "Internal link returns 404",
  "message": "The link to /docs/plans in the pricing table returns HTTP 404.",
  "route": "/pricing",
  "viewport": "desktop",
  "location": { "file": "src/components/PlanTable.tsx", "symbol": "PlanTable", "selector": "[data-testid=plan-compare-link]" },
  "subject": "https://localhost:3000/docs/plans",
  "suggestion": "The page was renamed to /docs/pricing-plans in #812. Update the href or add a redirect.",
  "evidence": { "url": "http://localhost:3000/pricing", "snippet": "<a href=\"/docs/plans\">Compare plans</a>" },
  "docsUrl": "https://gribble.dev/rules/links/broken"
}
```

| Field | Notes |
| --- | --- |
| `fingerprint` | Stable identity. 16 hex chars. Computed in code, never by a model. |
| `rule` | Rule id, `category/name`. Always a real registry entry, including for AI findings (`review/*`). |
| `severity` | `critical`, `error`, `warn` or `info`. |
| `source` | `deterministic` or `ai`. |
| `confidence` | 0–1, AI findings only. |
| `status` | `new`, `existing` or `fixed`, filled by the baseline diff. |
| `title` | One short line. Dry. |
| `message` | The detail. Also dry. |
| `route` | Normalized path, e.g. `/blog/[slug]`. |
| `viewport` | `mobile`, `desktop` or a custom name, when the finding is viewport-specific. |
| `location` | `file` + `symbol` where known, else `selector`, else a structural `path`. |
| `subject` | Rule-specific key — the broken URL, the failing asset, the untranslated key. |
| `suggestion` | How to fix it. |
| `evidence` | Screenshot path, HTML snippet, page URL, or rule-specific data. |
| `docsUrl` | `https://gribble.dev/rules/<rule>`, generated from the rule registry. |

Note what `location` does **not** contain: a line number. Line numbers move every time somebody adds an import. File plus component or symbol name survives refactors, which is what a fingerprint needs.

## Fingerprints

The fingerprint is the first 16 hex characters of a SHA-256 over five newline-joined parts:

```
rule + "\n" + targetName + "\n" + normalizedRoute + "\n" + locationKey + "\n" + subject
```

- **`rule`** — the rule id.
- **`targetName`** — which app in a [monorepo](/docs/monorepos); empty for a single-app repo. Two apps with the same bug get different fingerprints.
- **`normalizedRoute`** — lowercased, trailing slash stripped, query string dropped, and numeric or UUID path segments replaced with `[id]`. So `/Blog/Posts/1042?ref=x` and `/blog/posts/9971/` both normalize to `/blog/posts/[id]`.
- **`locationKey`** — the most stable locator available, in order: `file#symbol`, then `selector`, then the structural `path`.
- **`subject`** — the rule-specific key. For `links/broken` that is the target URL; for `network/failed-requests` the request URL; for `i18n/untranslated-keys` the leaked key.

Everything in that list is chosen to survive irrelevant change and to differ on relevant change. A finding keeps its identity when you reformat the file, reorder the DOM, or paginate to a different id. It gets a new identity when the rule, the app, the page, the component or the specific thing being complained about changes.

**Models never produce fingerprints.** When the agent reports a finding it must fill in structured fields — rule category, route, subject, title, location — and Gribble computes the hash from them. A model asked to produce a stable hash will produce a different one each run, and the entire comment lifecycle would collapse.

### Deduplication

Exact fingerprint matches are collapsed first. AI findings get a second, fuzzy pass: same route, same rule, and normalized titles at least 0.85 similar are treated as one finding. This catches the model reporting "Button label is unclear" on one step and "The CTA text is ambiguous" on another.

### Sorting

Findings are sorted by severity descending, then confidence descending, then deterministic before AI. That order governs the report, the terminal output and which findings survive the comment cap.

## Severity

Five values in `rules.yaml`, four of which can appear on a finding. There is no implicit escalation anywhere: a rule set to `warn` produces `warn` findings, full stop.

| Severity | Meaning | Typical rules | Gate | PR comment |
| --- | --- | --- | --- | --- |
| `critical` | The site is broken | `flows/replay`, `network/page-error`, `security/exposed-secrets` | **fail** | yes |
| `error` | User-visible defect | broken links, unlabelled form fields, CLS over threshold | **fail** | yes |
| `warn` | Quality regression | meta length, contrast, perf regression, all `review/*` | pass | yes |
| `info` | Suggestion | style nits | pass | no, report only |
| `off` | Disabled | — | — | — |

The gate verdict is precise: `summary.gate` is `fail` when at least one **new** finding has severity `error` or `critical` **and** comes from a deterministic rule or from `flows/replay`. Existing findings never fail a build, and neither do AI findings under the default configuration.

### AI severity capping and the confidence floor

The model returns a severity and a 0–1 confidence with each finding. Two things then happen before it reaches the report:

1. **Capping.** The severity is capped by the severity of the matching `review/<category>` rule. `review/*` rules default to `warn`, so a model insisting a finding is `critical` still lands at `warn` and cannot fail your build. Raise `review/ux: error` in `rules.yaml` if you want that to change; you generally should not.
2. **The floor.** Findings with confidence below `review.min_confidence` (default `0.7`) are dropped entirely — not downgraded, dropped. They do not reach the report, the baseline or the comment cap.

Raise `min_confidence` when review mode is noisy. Lower it when you are hunting and willing to sift.

## Comment lifecycle

Gribble is stateless. There is no database and no service tracking your findings. State lives in exactly two places: the `findings.json` ledger on your default branch, and hidden HTML markers inside the PR comments themselves.

**On a PR:**

- One pinned **summary comment** carrying `<!-- gribble:summary -->`. Every subsequent run finds it by that marker and edits it in place, so the thread does not fill up with one summary per push.
- One comment **per new finding**, carrying `<!-- gribble:fp:<fingerprint> -->`. When `location.file` is known it is posted as an inline review comment on that file; otherwise it is folded into the summary.

**On re-run:**

| Situation | What Gribble does |
| --- | --- |
| Fingerprint still present | Edits the existing comment, keeps the thread and any replies |
| Fingerprint gone | Edits the comment to "patched ✅" and resolves the thread |
| New fingerprint | Posts a new comment, up to the cap |
| Fingerprint in the baseline ledger | Counts it in the summary, never comments |

That last row is the diff-not-score principle in its most concrete form. Your existing 400 accessibility findings are a number in the summary, not 400 comments on a PR that touched the footer.

**The cap** applies only to new findings. `review.max_comments` defaults to 5, sorted by severity, then confidence, then deterministic-first. Everything else lives in the report:

> Showing 5 of 12 holes. The rest are in the full report.

## Suppression

Two ways to make a finding go away without fixing it. Both are decisions for a person. Your coding agent will propose them and explain the trade-off, but the [Gribble skill](/docs/skills) tells it never to suppress a finding on its own:

```prompt
Gribble flags the external link to our status page as broken, but it only fails from CI. Check whether it's a real problem, and if it isn't, tell me which fingerprint you would ignore and why instead of changing anything.
```

**Ignore one finding by fingerprint.** This is the precise tool — it suppresses exactly this problem on exactly this route, and a genuinely new instance elsewhere still gets reported.

```bash
gribble ignore 9f2c1d4a7b3e0c58
```

That appends to `ignore` in `rules.yaml`:

```yaml
ignore:
  - 9f2c1d4a7b3e0c58   # external link behind a login wall, checked manually
```

Add the comment. In six months nobody will remember why the hash is there, and an unexplained suppression is indistinguishable from a mistake.

**Turn the rule off**, globally or per route, in [rules.yaml](/docs/configuration/rules-yaml):

```yaml
rules:
  seo/twitter-card: off

overrides:
  - routes: ["/admin/**"]
    rules:
      seo/*: off
```

**Raise the confidence floor** to suppress a whole class of noisy AI findings:

```yaml
review:
  min_confidence: 0.85
```

### Choosing between suppression and the baseline

| You want | Use |
| --- | --- |
| This one finding never mentioned again | `gribble ignore <fp>` |
| This rule never mentioned on these routes | An `overrides` entry |
| This rule never mentioned anywhere | Set it to `off` |
| The current state accepted as the new normal | [`gribble baseline update`](/docs/concepts/baseline#updating-by-hand) |

The baseline is for "yes, that is how things are today". Ignores are for "this is not a real problem". Keeping them separate is what keeps the ledger honest.
