---
name: gribble
description: Use when fixing Gribble audit findings (`.gribble/runs/latest.json`), writing or editing flow files in `.gribble/flows/*.md`, or changing `.gribble/rules.yaml`, `.gribble/gribble.yaml` or `.gribble/guidelines.md`. Covers finding triage by severity, flow frontmatter and replay sidecars, and which setting belongs in which file.
metadata:
  version: "0.1.0"
---

# Gribble

Gribble sends tiny bugs to chew on a running site before the users do; this skill teaches you to feed them — fix what they find, describe the journeys they should walk, and tune the rules they check.

Everything lives in the `.gribble/` directory next to the app being audited:

```
.gribble/
  gribble.yaml      runtime settings (target URL, dev command, model, budget)
  rules.yaml        mechanical rules with ESLint-style severities
  guidelines.md     judgement-call conventions injected into the review model
  flows/*.md        user journeys in natural language
  flows/*.replay.json   generated deterministic replay sidecars
  baseline/         committed snapshot of known state (never hand-edit)
  runs/             audit output, gitignored; runs/latest.json is the newest report
```

## Fix findings

### 1. Read the report

The newest report is `.gribble/runs/latest.json` (same content as `.gribble/runs/<timestamp>/report.json`). It is a `Report` object, version 1:

```jsonc
{
  "version": 1,
  "gribbleVersion": "0.1.0",
  "generatedAt": "2026-01-30T10:12:03.441Z",
  "mode": "all",                      // "gate" | "review" | "all"
  "target": { "name": "apps/web", "url": "http://localhost:3000", "environment": "local" },
  "summary": {
    "counts": { "critical": 0, "error": 2, "warn": 5, "info": 1 },  // over status "new" only
    "newCount": 8, "existingCount": 3, "fixedCount": 1,
    "gate": "fail",
    "headline": "..."
  },
  "findings": [ /* Finding[] */ ],
  "routes": [ /* per-route status, metrics, snapshot and screenshot paths */ ],
  "flows": [ /* per-flow ok/kind/durationMs/error */ ],
  "durationMs": 48211
}
```

Each entry of `findings[]` is a `Finding`:

| field | type | meaning |
| --- | --- | --- |
| `fingerprint` | string | stable 16-hex-char id; the handle for `gribble ignore` and for PR comment threads |
| `rule` | string | rule id, `category/name` (e.g. `links/broken`, `a11y/img-alt`, `review/ux`) |
| `severity` | `"critical" \| "error" \| "warn" \| "info"` | fix order |
| `source` | `"deterministic" \| "ai"` | deterministic findings are checks in code; `ai` findings come from the review model |
| `confidence` | number, ai only | 0..1 |
| `status` | `"new" \| "existing" \| "fixed"` | relative to `.gribble/baseline/` |
| `title` | string | short, dry summary |
| `message` | string | the detail: what is wrong and where it was observed |
| `route` | string | normalized path, e.g. `/pricing` or `/blog/[slug]` |
| `viewport` | string, optional | `mobile`, `desktop`, … when the finding is viewport-specific |
| `location` | object, optional | `{ file?, symbol?, selector?, path? }` — where to make the edit |
| `subject` | string, optional | rule-specific key, e.g. the broken link target URL |
| `suggestion` | string, optional | the fix hint; start here |
| `evidence` | object, optional | `{ screenshot?, snippet?, url?, data? }` |
| `docsUrl` | string | `https://gribble.dev/rules/<rule>` |

### 2. Choose what to fix

- Work in severity order: `critical` > `error` > `warn` > `info`. `critical` and `error` block the gate; `warn` and `info` do not.
- Only fix findings with `status: "new"` unless the user asks for more. `existing` findings are already in the baseline (pre-existing debt, tracked but not blocking this change), and `fixed` ones are gone.
- Within a severity, prefer `source: "deterministic"` — those are precise and verifiable. `ai` findings are judgement calls; read `confidence` and the `message` before acting, and ask the user when the call is not obvious.
- Do not batch unrelated rules into one sweeping refactor. One finding, one minimal edit.

### 3. Locate the source

Use `location`, in this order:

1. `location.file` (+ `location.symbol`) — open that file and find the symbol. This is the edit site.
2. `location.selector` — a CSS selector in the rendered page. Grep the repo for the class names, test ids, or text in the selector to find the component that renders it.
3. `location.path` — a structural fallback (position in the accessibility tree). Use `route` plus the rendered text in `message`/`evidence.snippet` to find the component.

When only `route` is known, map the route to the source file through the framework's routing convention (`app/`, `pages/`, `routes/`, …).

Run `gribble explain <rule>` for the rule's full description, options, examples and fix hint, or open `docsUrl`. Do this before fixing any rule you do not already understand.

### 4. Apply a minimal fix

Fix the cause named by the rule, not the symptom. Keep the diff small and local: add the missing `alt`, correct the broken href, label the input, size the image. Do not change the rule's severity to make a finding go away.

### 5. Verify

```bash
pnpm exec gribble audit --mode gate      # fall back to: npx gribble audit --mode gate
```

`--mode gate` runs only the deterministic checks and flow replays, so it is fast and does not spend model budget. Exit code 0 means the gate passes, 1 means it still fails, 2 means a config or auth error. A full `gribble audit` (gate plus AI review) is needed only to re-check `review/*` findings.

Re-read `.gribble/runs/latest.json` after the run and confirm the fingerprints you targeted are gone.

### 6. False positives and things never to touch

- If a finding is wrong, do not silently edit `rules.yaml` to hide it. Tell the user and suggest the fingerprint-scoped escape hatch:

  ```bash
  pnpm exec gribble ignore <fingerprint>
  ```

  That appends the fingerprint to `ignore:` in `rules.yaml` and leaves the rule on for everything else. Turning a rule `off` or lowering its severity is a team decision — propose it, explain the trade-off, and let the user decide.
- Never hand-edit anything under `.gribble/baseline/`. It is a machine-written snapshot of the known state on the main branch; editing it corrupts the new/existing/fixed diff. It is refreshed by `gribble baseline update` or `gribble audit --update-baseline`.
- Never edit files under `.gribble/runs/` — they are regenerated on every audit and gitignored.

## Write flows

A flow is one user journey described in Markdown at `.gribble/flows/<name>.md`. It is read by an AI tester that drives a real browser, so it must be specific enough to execute and to judge.

### Format

```md
---
name: checkout
requires_auth: shopper
env: [local, preview]
tags: [commerce, critical-path]
---

Body: natural-language steps, in order.
```

Frontmatter keys:

| key | type | meaning |
| --- | --- | --- |
| `name` | string | flow id; keep it equal to the filename stem, lowercase and hyphenated |
| `requires_auth` | `false` or a profile name | `false` for anonymous flows; otherwise the name of a profile under `auth.profiles` in `gribble.yaml` (e.g. `shopper`, `admin`). Credentials live in env vars named by that profile, never in this file. |
| `env` | list of strings | environments this flow may run in, matching `environments.*` in `gribble.yaml`. Omit to run everywhere. |
| `tags` | list of strings | free-form labels for grouping and selection |

The body is written for an AI tester. Cover four things:

1. **Start URL** — where the journey begins.
2. **Actions** — what to click, type and submit, in order, identified by what a user sees (visible label, heading, placeholder) rather than by brittle internal selectors.
3. **Expected outcomes** — what must be visible or true after each meaningful step.
4. **Failure conditions** — what makes this flow a failure, so the tester does not have to guess.

Keep secrets, real customer data and destructive actions out of flows. If a flow must write data, say so explicitly and confine it to test accounts.

### A good flow

```md
---
name: checkout
requires_auth: shopper
env: [local, preview]
tags: [commerce, critical-path]
---

Start at `/`.

1. Search for "running shoes" using the search box in the header and submit.
2. Expect a results page with at least one product card.
3. Open the first result. Note the product title and the displayed price.
4. Click "Add to cart". Expect the cart badge in the header to read 1.
5. Go to `/cart`. Expect one line item whose title and price match step 3.
6. Click "Checkout". Expect the checkout page with the shipping form and an order
   summary whose total equals the line item price plus the shipping cost shown.
7. Fill the shipping form with the prefilled test address and continue to payment.
8. Expect the payment step to load with the same total.

Stop before submitting payment; this flow never places a real order.

Failure: search returns no results, the price on the product page differs from the
price in the cart or the order summary, the cart badge does not update, or any step
leaves the user on an error page or a page with no way forward.
```

### A bad flow

```md
---
name: checkout
---

Test the checkout flow and make sure it works.
```

Why it fails: no start URL, no steps, no expected values, no definition of failure, and no `requires_auth`, so the tester cannot sign in and cannot tell a broken checkout from a working one. Every run produces a different, unreproducible result.

### Replay sidecars

Once a flow runs cleanly, Gribble can freeze it into `.gribble/flows/<name>.replay.json` — a recorded step list (`navigate`, `click`, `fill`, `press`, `wait_for`, `expect_text`, `expect_url`, `expect_visible`) that `--mode gate` replays deterministically, with no model calls. When a sidecar exists, the flow becomes a gate check (`flows/replay`, severity `critical` by default).

The sidecar is generated, not authored: do not hand-edit it. If the journey changed, update the `.md` and let Gribble re-record; if a replay fails because the UI legitimately changed, fix the flow description and re-record rather than patching JSON selectors. The `.md` file remains the source of truth that humans read and review.

## Change rules and guidelines

Three files, three jobs. Pick by asking what kind of statement the convention is.

| the convention is… | goes in | shape |
| --- | --- | --- |
| mechanical and checkable by code ("every page has exactly one h1", "LCP under 2.5s") | `.gribble/rules.yaml` | rule id + severity (+ options) |
| a runtime setting ("audit this URL", "start with this command", "cap comments at 5") | `.gribble/gribble.yaml` | typed configuration |
| a judgement call ("error messages must be friendly", "keep the tone restrained") | `.gribble/guidelines.md` | natural language prose |

### rules.yaml — mechanical rules

ESLint-shaped:

```yaml
# yaml-language-server: $schema=https://gribble.dev/schema/rules.json
extends:
  - gribble:recommended          # presets: gribble:recommended | gribble:strict | gribble:seo | gribble:a11y

ignore: []                       # finding fingerprints; add via `gribble ignore <fingerprint>`

rules:
  seo/single-h1: error           # bare severity
  links/broken-external: [warn, { timeout: 10000, ignore: ["linkedin.com"] }]   # [severity, options]
  a11y/color-contrast: [warn, { level: AA }]
  seo/twitter-card: off

overrides:                       # route-scoped; later entries win
  - routes: ["/admin/**", "/internal/**"]
    rules:
      seo/*: off                 # wildcard keys are allowed
      perf/lighthouse-performance: off
  - routes: ["/blog/**"]
    rules:
      seo/meta-description: error
```

- Severity values: `off | info | warn | error | critical`. There is no implicit escalation — the value you write is the value that is reported.
- Options are per-rule; `gribble explain <rule>` prints the option schema and defaults.
- Prefer narrowing with `overrides` over turning a rule `off` globally, and prefer `ignore` with a fingerprint over either when the problem is one specific false positive.
- AI (`review/*`) findings are capped by the severity of their matching `review/<category>` rule, which defaults to `warn` — so the review model can never block a merge unless a human raises that severity on purpose.

### gribble.yaml — runtime settings

```yaml
# yaml-language-server: $schema=https://gribble.dev/schema/gribble.json
target:
  url: http://localhost:3000     # ${ENV_VAR} interpolation allowed
  start: pnpm dev                # optional; Gribble waits until the URL responds
  routes: auto                   # auto | crawl | [list of paths]
model: provider/id               # optional; omit to use the user's default
review: { max_comments: 5, min_confidence: 0.7, vision: false }
budget: { max_steps: 200, max_tokens: 2000000 }
allowed_origins: [localhost, "*.vercel.app"]
auth:
  profiles:
    shopper: { type: flow, flow: flows/auth/login.md, env: { email: GRIBBLE_USER_EMAIL, password: GRIBBLE_USER_PASSWORD } }
environments:
  preview: { target: { url: "${PREVIEW_URL}" } }   # deep-merged over the top level with --env preview
```

Secrets never go in YAML — only the **names** of environment variables. If a convention needs a password, an API key or a cookie value, add the variable name here and tell the user to set the variable; never write the value into any tracked file.

### guidelines.md — judgement calls

Plain Markdown prose, injected into the review model as context for `review/*` findings. Use it for things a checker cannot decide:

```md
## Copy
- Error messages say what happened and what to do next. No blame, no stack traces.
- Use "sign in", never "log in" or "login" as a verb.

## Interaction
- Every destructive action is confirmable and reversible, or clearly warned about.
- Empty states explain what will appear here and how to create the first item.
```

Guidelines add to Gribble's base prompt; they cannot override or replace it. If a guideline is really a hard requirement that code could check, move it to `rules.yaml` — the review model is probabilistic, the gate is not.

### Severity and gating

| severity | gate | PR comment |
| --- | --- | --- |
| `critical` | fail | yes |
| `error` | fail | yes |
| `warn` | pass | yes |
| `info` | pass | report only |
| `off` | — | — |

Baseline (`existing`) findings are counted but never commented on, and the comment cap (`review.max_comments`) applies to new findings sorted by severity, then confidence, then deterministic-before-AI.

### Monorepos

The unit is one `.gribble/` per app (`apps/web/.gribble/`, `apps/docs/.gribble/`), each with its own target, flows and baseline. Shared conventions cascade from the repository root:

- Root `.gribble/rules.yaml` is merged layer by layer down to the app, with the app's values overriding the root's.
- Root `.gribble/guidelines.md` is concatenated ahead of the app's guidelines.
- The root `.gribble/` holds only shared rules and guidelines — no `target`.

Put a convention that applies to every app at the root; put app-specific thresholds, route overrides and flows in that app's `.gribble/`. Audit one app with `gribble audit --target apps/web` from the root, or `gribble audit --all` to sweep every `.gribble/` in the repo.
