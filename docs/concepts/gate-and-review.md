---
title: Gate and review
description: Two modes with different contracts — one is deterministic and can block a merge, the other is an AI agent that only ever comments.
order: 20
---

Gribble runs two kinds of check, and keeping them apart is the central design decision of the product. One is code, reproducible, and allowed to fail your build. The other is a model, useful but non-deterministic, and structurally prevented from blocking anyone.

## gate

Gate mode is ordinary code. No model is loaded, no tokens are spent, and the same commit produces the same findings every time.

No model runtime is *installed* either: the pi packages behind review mode are [optional peer dependencies](/docs/getting-started#the-review-runtime-is-optional), so a fresh gate-only install never fetches a provider SDK. (A pnpm lockfile from Gribble 0.3 is the exception: it keeps the runtime across the upgrade until you [re-resolve it](/docs/getting-started#upgrading-from-0-3).)

What runs in gate:

- **Links and network** — internal 4xx/5xx, external link checks, redirect chains, empty `href`s, failed requests, console errors, asset sizes, request counts.
- **SEO** — title and meta description length, single `h1`, heading order, canonical, `robots` and `noindex`, sitemap, `lang`, Open Graph, structured data.
- **Accessibility** — an axe run per route, plus the derived rules for image alt text, form labels and accessible names.
- **Performance** — a Lighthouse run per route with thresholds on the performance score, LCP, CLS, TBT and page weight.
- **HTML sanity** — doctype, charset, viewport meta, duplicate ids.
- **Security** — HTTPS-only, mixed content, exposed secret patterns in HTML and JS.
- **UI hard rules** — computed styles compared against your design tokens, overlap and overflow math, placeholder text, broken images. All measured in code, not judged by a model.
- **Flow replay** — the `flows/replay` rule runs the recorded step list for every flow that has a `.replay.json` sidecar.
- **Regressions** — `perf/regression`, `visual/regression` and `structure/regression` compare this run against the [baseline](/docs/concepts/baseline).

```bash
gribble audit --mode gate
```

Gate is what you want in a required status check, in a pre-push hook, and as the verification step after your coding agent claims it fixed something.

## review

Review mode starts an agent session and hands it the site. It:

- walks every flow in [`.gribble/flows/*.md`](/docs/flows) and reports where a journey breaks down;
- explores routes that nobody wrote a flow for, looking for dead ends, missing error states and confusing interactions;
- judges what it sees against your [`guidelines.md`](/docs/guidelines);
- writes a plain-language fix suggestion for each finding, pointing at the component or file responsible.

```bash
gribble audit --mode review
```

Review findings map onto the `review/*` rules — `review/guidelines`, `review/ux`, `review/copy`, `review/dead-ends`, `review/flow-coverage`, `review/error-handling` — which default to `warn`.

### How the model perceives the page

By default, **the model does not look at screenshots.** It reads a structured snapshot instead:

- a simplified DOM with scripts, styles and SVG path data removed, wrapper elements collapsed, and meaningful attributes kept (`role`, `aria-*`, `href`, `alt`, `data-testid`);
- a Playwright aria snapshot in compact YAML;
- bounding boxes for interactive elements, plus overlaps, overflow and undersized touch targets **already computed in code**;
- a subset of computed styles compared against your design tokens in code, with only the violations handed over;
- Lighthouse metrics, console errors and failed requests.

This is not a cost saving hack. A model reading a DOM knows the exact hex colour, the exact font size and the exact accessible name; a model looking at a PNG is guessing at all three. Text beats pixels for everything except actual pictures.

Screenshots are still taken — for pixel-diff visual regression (done in code, never by the model) and for humans to look at in `runs/`. The `screenshot` tool is only handed to the model when you set `review.vision: true`, for the cases where the data genuinely cannot say: canvas rendering, image content, a chart that looks wrong.

### Deterministic results feed the agent

Gate checks run **before** the agent and their results are injected as context. The model does not spend steps rediscovering that a link is broken; it spends them on the things only it can do. This also means `--mode all` is cheaper than running the two modes separately.

### Guardrails

pi has no permission system, so Gribble adds one in the shell around it:

- **Origin allowlist.** The agent cannot navigate off your target host plus whatever you list in `allowed_origins`.
- **No side effects off staging.** Form submissions, orders and similar destructive interactions are blocked unless the host is a staging or preview origin you allowed.
- **Budgets.** A hard cap on steps, tokens and optionally dollars per audit. The run ends cleanly and reports what it got when a budget is hit.
- **No CAPTCHA solving.** Ever. See [Auth](/docs/auth).
- **Read-only tools.** The agent gets `read`, `grep`, `find`, `ls` and Gribble's audit tools. No `edit`, `write` or `bash`.

## Why review never blocks

Three independent mechanisms, each sufficient on its own:

1. **Severity capping.** A model returns a severity with each finding, but that severity is capped by the matching `review/<category>` rule, which defaults to `warn`. Even if the model says `critical`, the finding lands as `warn`, and `warn` does not fail the gate.
2. **A confidence floor.** Each AI finding carries a 0–1 confidence. Anything below `review.min_confidence` (default `0.7`) is dropped before it reaches the report.
3. **The gate verdict ignores source.** `summary.gate` is `fail` only when a **new** finding with severity `error` or `critical` came from a deterministic rule or from `flows/replay` — or, when a project opts in with [`coverage.required`](/docs/configuration/gribble-yaml#coverage), when required routes, flows, checks or the baseline did not execute. An incomplete review is labeled in the report's [`completeness`](/docs/report-format#completeness) and never fails the gate.

If you genuinely want an AI finding to be able to block a merge, you can raise a `review/*` rule to `error` in `rules.yaml`. We think you should not, at least not for a while.

## Comment volume

Every finding lands in the run report. Only the top `review.max_comments` **new** findings become PR comments — default `5`, deliberately low, sorted by severity, then confidence, then deterministic-before-AI. The rest are linked from the summary:

> Showing 5 of 12 holes. The rest are in the full report.

A report nobody reads because it has ninety comments is worth less than five comments somebody acts on.

## Choosing a mode

| Situation | Mode |
| --- | --- |
| Required status check on PRs | `gate` |
| PR review comments | `review` or `all` |
| After your coding agent fixed something | `gate` |
| Nightly, or before a release | `all` |
| No model credentials available, or no review runtime installed | `gate` |

The default for `gribble audit` and for the GitHub Action is `all`.

## The flywheel

Review finds things gate cannot describe yet. When review keeps reporting the same real problem, promote it:

- a repeated journey the agent had to figure out → write it down as a [flow](/docs/flows), then record a replay sidecar so `gate` walks it deterministically forever;
- a repeated judgement call → write it into [`guidelines.md`](/docs/guidelines) so the model stops rediscovering it, or into [`rules.yaml`](/docs/configuration/rules-yaml) if it turns out to be mechanically checkable after all.

Over time the expensive, fuzzy mode shrinks and the cheap, deterministic one grows. That is the intended direction of travel.
