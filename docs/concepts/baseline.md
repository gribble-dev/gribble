---
title: Baseline
description: The committed snapshot of your main branch's known state — everything Gribble reports is a diff against it.
order: 21
---

The baseline is Gribble's memory. It is a snapshot of what your main branch looks like today, committed to the repository, and every conclusion on a pull request is measured against it.

This is what lets Gribble be useful on a codebase that is not perfect. A ten-year-old app with 400 accessibility findings and a Lighthouse score of 41 gets a clean Gribble run, as long as the PR does not make any of it worse.

## Layout

The baseline lives in `.gribble/baseline/` and **is committed**.

```
.gribble/baseline/
  findings.json                          known-problem ledger
  metrics.json                           per-route performance numbers
  snapshots/<route-slug>.aria.yaml       aria snapshot per route
  screenshots/<route-slug>@<viewport>.webp
  meta.json                              commit, time, version, model, viewports
```

### `findings.json`

The ledger of problems that already exist on main.

```json
{
  "version": 1,
  "findings": [
    {
      "fingerprint": "9f2c1d4a7b3e0c58",
      "rule": "a11y/img-alt",
      "severity": "error",
      "route": "/blog/[slug]",
      "location": { "file": "src/components/PostHero.tsx", "symbol": "PostHero" },
      "subject": "hero-image",
      "firstSeen": { "commit": "3f9a21c", "at": "2025-02-11T09:14:03.000Z" }
    }
  ]
}
```

Each PR run compares its findings against this list by [fingerprint](/docs/concepts/findings#fingerprints) and sorts everything into three buckets:

| Status | Meaning | What happens |
| --- | --- | --- |
| `new` | Not in the ledger | Reported, commented on, counted towards the gate |
| `existing` | In the ledger | Counted in the summary, never commented on |
| `fixed` | In the ledger, gone from this run | Celebrated in the summary |

`firstSeen` is kept so you can tell a problem that arrived last week from one that has been there since 2019.

### `metrics.json`

Per-route performance numbers, so `perf/regression` can work on deltas instead of absolutes.

```json
{
  "version": 1,
  "routes": {
    "/": { "lcpMs": 1840, "cls": 0.04, "tbtMs": 120, "lighthousePerformance": 88, "pageWeightKb": 940, "requestCount": 42 },
    "/pricing": { "lcpMs": 2210, "cls": 0.02, "tbtMs": 180, "lighthousePerformance": 81, "pageWeightKb": 1310, "requestCount": 58 }
  }
}
```

With the default `perf/regression` options, a PR fails on a 500 ms LCP increase or a 5-point score drop — regardless of whether the starting score was 95 or 41.

### `snapshots/`

One Playwright aria snapshot per route, as compact YAML. Plain text, small, and readable in a git diff — which is the point. `structure/regression` compares this run's snapshot against the committed one and notices when a nav item vanishes, a form disappears or a landmark changes role.

Reviewing a Gribble baseline diff is often the fastest way to see what a big refactor actually did to the page structure.

### `screenshots/`

One image per route per viewport, scaled to a fixed width, for `visual/regression` pixel comparison. WebP where the encoder is available, PNG otherwise.

Control how they are stored with `baseline.screenshots` in [`gribble.yaml`](/docs/configuration/gribble-yaml):

| Value | Behaviour |
| --- | --- |
| `commit` | Written into `.gribble/baseline/screenshots/` and committed. Fine for small sites: three routes and two viewports are under 200 KB. |
| `lfs` | Same paths, tracked via Git LFS. Recommended for large sites — you will need a matching `.gitattributes` entry. |
| `off` | No baseline screenshots. `visual/regression` cannot run. The default. |

Screenshots are opt-in because they are binary churn in git history and because pixels differ between rendering platforms. `visual/regression` is off in `gribble:recommended`; turn it on together with `baseline.screenshots`. Baseline screenshots are capped at 1280px wide and encoded as WebP at quality 70.

`lfs` writes `.gribble/baseline/.gitattributes` so the screenshot folder goes through Git LFS; install Git LFS before committing, Gribble warns when it is missing.

`meta.json` records the platform that rendered the screenshots (OS, CPU architecture, browser build). When a run happens on a different platform, for example a macOS laptop comparing against a baseline captured on Linux CI, pixel comparison is skipped with a warning instead of reporting font-rendering noise as a regression. Refresh the baseline from the same environment to compare pixels. The aria snapshots behind `structure/regression` are plain text and compare across platforms; they stay on by default and catch the regressions that matter most: a navigation item, form or landmark that disappeared.

If the repository size worries you, `off` is a legitimate choice: `structure/regression` on aria snapshots catches most of what matters at a fraction of the bytes.

### `meta.json`

```json
{
  "version": 1,
  "commit": "3f9a21c",
  "branch": "main",
  "at": "2025-02-11T09:14:03.000Z",
  "gribbleVersion": "1.4.0",
  "model": { "provider": "<provider>", "id": "<model>" },
  "viewports": { "mobile": { "width": 390, "height": 844 }, "desktop": { "width": 1366, "height": 768 } }
}
```

The model is recorded because changing models changes which `review/*` findings appear. When a wave of new AI findings shows up on an unrelated PR, `meta.json` usually explains it.

### Route slugs

File names come from the route: lowercase, non-alphanumeric characters replaced with `_`, collapsed and trimmed.

| Route | Slug |
| --- | --- |
| `/` | `index` |
| `/pricing` | `pricing` |
| `/blog/[slug]` | `blog__slug_` |
| `/docs/api/v2` | `docs_api_v2` |

## Bootstrap mode

When there is no baseline — first ever run, or a new app in a monorepo — Gribble enters **bootstrap mode**:

- everything it finds is recorded as the known state rather than reported as new;
- no PR comments are posted;
- the gate passes;
- `report.baseline.bootstrap` is `true`, so consumers can tell;
- you are told to commit the result.

```
No baseline yet — this run is the baseline. 18 findings recorded as known.
Commit .gribble/baseline/ so future runs have something to diff against.
```

Commit `.gribble/baseline/` on main and the next run is a real diff. Do not try to clean up all 18 findings before committing; the point of the baseline is that you do not have to.

## The baseline is read-only on pull requests

A PR run never writes the baseline. If it did, a PR could quietly bless its own regressions, and the second run would find nothing wrong.

The baseline is only updated from your default branch, after a merge.

## Update strategies

`baseline.update` in `gribble.yaml`:

### `commit` (default)

On a push to the default branch, the Action runs with `update-baseline: true` and commits `.gribble/baseline/` back to main with `[skip ci]`, the way a bot updates a lockfile.

```yaml
# .github/workflows/gribble.yml
on:
  push:
    branches: [main]

permissions:
  contents: write

jobs:
  baseline:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: gribble-dev/action@v1
        with:
          update-baseline: true
```

### `pr`

Same run, but instead of pushing to main the Action opens a `chore: update gribble baseline` pull request. Use this when your default branch is protected against direct pushes, or when you want a human to eyeball baseline changes. You will need `pull-requests: write`.

### `manual`

Gribble never writes the baseline in CI. You update it locally and commit it yourself:

```bash
gribble baseline update
git add .gribble/baseline
git commit -m "chore: update gribble baseline"
```

## Updating by hand

Two equivalent ways:

```bash
gribble audit --update-baseline   # run an audit, then write the baseline from it
gribble baseline update           # same thing, shorthand
```

Both write `.gribble/baseline/` from the run that just finished. Neither commits anything — that is your call, every time.

Reach for these when:

- you deliberately accepted a regression and want to stop being told about it;
- you rewrote a page and the aria snapshot and screenshots are legitimately different;
- you changed viewports, routes or rule severities in a way that invalidates the old ledger;
- you are onboarding a new app in a monorepo.

Suppressing a **single** finding is a different job — use `gribble ignore <fingerprint>` instead of re-baselining everything. See [Findings](/docs/concepts/findings#suppression).

## Incremental runs

With `gribble audit --changed`, Gribble uses the git diff to decide which routes a change can affect and audits only those. The comparison is then scoped to those routes' baseline entries: unvisited routes keep their existing findings and metrics untouched, and are never reported as fixed just because nobody looked.

Full audits belong in nightly runs and before releases.

## Committing a baseline: practical notes

- **Review the diff.** A baseline diff is a readable summary of what changed structurally. Do not rubber-stamp it.
- **Expect churn on dynamic content.** A route that renders live data will produce screenshot noise. Raise `visual/regression`'s `threshold`, exclude the viewport, or set `baseline.screenshots: off` for that project.
- **One baseline per app.** In a [monorepo](/docs/monorepos) each `.gribble/` has its own `baseline/`; the root `.gribble/` holds only shared rules and guidelines and has no baseline.
- **Rebase conflicts happen.** Two PRs both updating the baseline will conflict in `findings.json`. Take main's version and re-run `gribble baseline update`; do not hand-merge the JSON.
