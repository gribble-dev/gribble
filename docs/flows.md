---
title: Flows
description: Describe user journeys in Markdown; let the gribbles walk them.
order: 40
---

A flow is a user journey written in plain language, in a Markdown file, in your repository. Review mode walks it. Once it has been walked successfully, Gribble can record the exact steps into a sidecar file so gate mode can replay it deterministically forever.

Flows live in `.gribble/flows/` and are committed.

```
.gribble/flows/
  README.md
  smoke.md
  smoke.replay.json
  checkout.md
  checkout.replay.json
  auth/login.md
```

## Format

Markdown with a small frontmatter block. The body is prose written for a person, which happens to also be the instruction a model reads.

```md
---
name: checkout
requires_auth: user
env: [preview, staging]
tags: [commerce, critical]
---

Sign in as the test user, search for "running shoes", add the first result to
the cart, open the cart, and go to checkout. Confirm the line item price and
the total match what the product page showed.

Do not submit the payment form — stop at the payment step.
```

That is the whole format. Prose, and enough structure that a program can route it.

## Frontmatter

| Field | Type | Description |
| --- | --- | --- |
| `name` | string | The flow's identity. Used in reports, in `flows/replay` findings, and to find the `<name>.replay.json` sidecar. Keep it stable — renaming a flow orphans its replay file and its baseline history. |
| `requires_auth` | string \| boolean | An [auth profile](/docs/auth) name from `gribble.yaml`, e.g. `user` or `admin`. `true` means the default profile. Omit for flows that run logged out. |
| `env` | string[] | Environment names in which this flow should run. A flow with `env: [staging]` is skipped unless the audit was started with `--env staging`. Omit to run everywhere. |
| `tags` | string[] | Free-form labels. Useful for grouping in the report and for your own filtering. |

`name` is the only required field.

## Writing good steps

The body is read by a model that can see the page and by a human who has to maintain the file. Both audiences want the same thing: say what the user is trying to achieve and what has to be true at the end, not which CSS selectors to click.

**Be specific about intent and about the check.**

Weak:

> Test the checkout.

Better:

> Sign in as the test user, add a product to the cart, and go to checkout. Confirm the total matches the sum of the line items.

The second one says what "working" means. Without it the agent will decide for itself, differently each run, and you get a flaky flow.

**State the outcome, not the mechanics.** "Search for running shoes" is right. "Click `#search-input`, type, press `#submit-btn`" is wrong — it breaks the first time somebody renames a class, and it throws away the agent's ability to notice that the search box moved somewhere unreasonable.

**Say what must not happen.** Guardrails already block obvious side effects off staging, but the flow is where you record intent:

> Do not submit the payment form — stop at the payment step.
> Do not delete the test account at the end; other flows reuse it.

**Use stable data.** A flow that depends on "the first product in the list" is fine if the list is seeded and deterministic, and a coin flip if it is a live catalogue. When in doubt, name the fixture: "search for the seeded product `TEST-SHOE-01`".

**Keep flows small and single-purpose.** One journey per file. `checkout.md`, `signup.md`, `password-reset.md`. A 40-step mega-flow fails somewhere in the middle and tells you very little, and it burns your step budget.

**Never put secrets in the body.** Reference the auth profile with `requires_auth` and let the env-var indirection handle credentials. Anything you type into a flow file is committed to git.

**Mind the clock.** `flows/max-duration` warns at 60 seconds by default. A flow that legitimately takes longer wants either a raised threshold or a split.

## The replay sidecar

Prose is flexible and non-deterministic, which is exactly what you want when exploring and exactly what you do not want in a required status check. The sidecar bridges the two.

When review mode successfully walks a flow, it records what it actually did into `<name>.replay.json` next to the Markdown file. From then on, **gate mode replays those steps directly** — no model, no tokens, same result every time — under the `flows/replay` rule, which defaults to `critical`.

```json
{
  "version": 1,
  "name": "checkout",
  "startUrl": "/products",
  "steps": [
    { "action": "fill", "selector": "[data-testid=search]", "value": "running shoes" },
    { "action": "press", "key": "Enter" },
    { "action": "wait_for", "selector": "[data-testid=result-card]", "timeoutMs": 5000 },
    { "action": "click", "selector": "[data-testid=result-card]:first-child", "description": "Open the first search result" },
    { "action": "expect_visible", "selector": "[data-testid=add-to-cart]" },
    { "action": "click", "selector": "[data-testid=add-to-cart]" },
    { "action": "wait_for", "text": "Added to cart" },
    { "action": "navigate", "url": "/cart" },
    { "action": "expect_text", "text": "running shoes", "selector": "[data-testid=cart-line]" },
    { "action": "click", "selector": "[data-testid=checkout]" },
    { "action": "expect_url", "pattern": "^/checkout" }
  ]
}
```

### Step actions

| Action | Fields | Meaning |
| --- | --- | --- |
| `navigate` | `url` | Go to a URL. Relative paths resolve against the target. |
| `click` | `selector`, `description?` | Click an element. `description` is for humans reading a failure. |
| `fill` | `selector`, `value`, `secret?` | Type into a field. `secret: true` redacts the value in logs and reports. |
| `press` | `key` | Press a key, e.g. `Enter`, `Escape`, `Tab`. |
| `wait_for` | `selector?`, `url?`, `text?`, `timeoutMs?` | Wait for a condition. At least one of the three must be given. |
| `expect_text` | `text`, `selector?` | Assert text is present, optionally within a selector. |
| `expect_url` | `pattern` | Assert the current URL matches a regular expression. |
| `expect_visible` | `selector` | Assert an element is visible. |

The `expect_*` actions are the point. A replay that only navigates and clicks proves the buttons exist; a replay with assertions proves the journey worked. When review records a flow it derives assertions from the confirmations your prose asked for — which is another reason to write "confirm the total matches the line items" instead of "check the cart".

A failing step produces a `flows/replay` finding naming the flow, the step index, the action and what was expected. `flows/max-duration` produces a separate `warn` when the whole replay takes too long.

### Editing sidecars by hand

You may. It is JSON, the schema is small, and tightening a selector or adding an assertion by hand is a perfectly reasonable thing to do. Two cautions: hand edits are overwritten the next time review re-records the flow, and a selector you invent is not one that was observed to work. Prefer `data-testid` attributes over structural selectors when you edit; they are what the recorder prefers too, and they survive redesigns.

Delete the sidecar and gate stops replaying that flow; review will re-record it on the next run.

## Promoting an explored flow

This is the flywheel, and it is the main reason flows exist in two forms.

1. **Review explores.** With `review.explore: true` (the default) the agent visits routes that no flow describes. It finds the signup journey nobody wrote down, and either walks it successfully or raises a `review/flow-coverage` finding saying an important journey is undocumented.

2. **You write it down.** Turn the journey into a flow file:

   ```md
   ---
   name: signup
   tags: [onboarding]
   ---

   From the landing page, start a signup with a fresh test email address.
   Complete the form, confirm the welcome screen appears, and confirm the
   account menu shows the new user's email.
   ```

3. **Run review once.** It walks the new flow and writes `signup.replay.json`.

4. **Commit both files.** From now on `gribble audit --mode gate` replays signup on every PR, deterministically, at zero token cost, and a break is a `critical` finding that fails the build.

What used to be an expensive, fuzzy check is now a cheap, certain one. Repeat until the interesting part of review is only the genuinely new stuff.

Going the other way is just as valid: when a journey changes so much that the recorded steps are meaningless, delete the sidecar, update the prose, and let review re-record.

## Auth flows

Login flows live under `flows/auth/` by convention and are referenced from `gribble.yaml`:

```yaml
auth:
  profiles:
    user:
      type: flow
      flow: flows/auth/login.md
      env: { email: GRIBBLE_USER_EMAIL, password: GRIBBLE_USER_PASSWORD }
```

```md
---
name: login
---

Go to the sign-in page. Enter the test user's email and password from the
environment, and submit. Confirm the account menu shows the user's email.
```

The flow refers to credentials by intent; the actual values come from the environment variables named in the profile, and are redacted from session logs. An auth flow runs at most once per audit — the resulting browser storage state is cached in `.gribble/cache/auth/<profile>.json` and reused. See [Auth](/docs/auth).

## Flows in a monorepo

Flows are **not** cascaded. Each app's `.gribble/flows/` is its own; a checkout journey in `apps/shop` means nothing in `apps/admin`. Only `rules.yaml` and `guidelines.md` cascade. See [Monorepos](/docs/monorepos).

## Checklist for a healthy flow directory

- One journey per file, named after the journey.
- Every flow states at least one thing that must be true at the end.
- Every flow that needs a login declares `requires_auth`.
- Critical journeys have a committed `.replay.json` so gate covers them.
- No credentials, tokens or personal data in any flow body.
- Environment-specific flows declare `env`, so local runs do not fail on a staging-only journey.
