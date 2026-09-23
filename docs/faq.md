---
title: FAQ
description: Cost, non-determinism, false positives, privacy, Windows, mobile, and why not just use Lighthouse CI.
order: 90
---

## Why not just use Lighthouse CI, axe CI and Percy?

Use them. Gribble runs Lighthouse and axe itself, and does pixel-diff visual regression, so it overlaps with all three — but the overlap is the cheap part.

What those tools cannot do is answer questions with no metric behind them. Does the checkout journey still work end to end? Does this empty state tell the user what to do next? Is the same button called "Contact sales" here and "Talk to sales" there? Is there any way back from this page? Did we ship a `TODO` in a heading? A Lighthouse score of 94 is compatible with a completely broken signup form.

The other difference is shape. Those tools are three configurations, three dashboards, three sets of thresholds and three things to wire into CI. Gribble is one config, one baseline, one report, one PR comment — and the deterministic half is exactly as reproducible as they are, because it is the same engines underneath.

If you already have a Lighthouse CI setup you are happy with, set `perf/*` rules to `off` and use Gribble for the rest. Nothing here demands exclusivity.

## How do I control cost?

Several levers, roughly in order of effect:

- **Run `--mode gate` in CI.** Deterministic checks, flow replay and all regression rules run with no model at all. Zero tokens, and no model runtime installed either — the pi packages are [optional peer dependencies](/docs/getting-started#the-review-runtime-is-optional), so a fresh gate-only install skips three provider SDKs and the AWS credential chain. A pnpm lockfile carried over from 0.3 keeps them until you [re-resolve it](/docs/getting-started#upgrading-from-0-3). Many teams run gate on every PR and review nightly.
- **Use `--changed`.** Only routes the diff can affect are audited.
- **Set budgets.** `budget.max_steps`, `budget.max_tokens` and optionally `budget.max_cost_usd` in `gribble.yaml` are hard caps; the run ends cleanly and reports what it has.
- **Keep `review.vision: false`** — the default. The model reads structured page snapshots instead of images, which is cheaper *and* more accurate.
- **Promote flows.** Every explored journey you turn into a recorded [replay sidecar](/docs/flows#the-replay-sidecar) moves work from the expensive mode to the free one, permanently.
- **Pick a cheaper model.** `gribble models` sorts by recommendation, and the recommended set is chosen partly on price. Gate does not care which model you picked, because it does not use one.

Every audit prints its actual token count and dollar cost, and the same numbers are in `report.budget`. Measure your own site before optimising.

## AI is non-deterministic. How can this be in CI?

Because the non-deterministic half is not allowed to matter to your build.

The gate verdict is `fail` only when a **new** finding with severity `error` or `critical` comes from a **deterministic rule or `flows/replay`**. AI findings are additionally capped at their `review/*` rule severity, which defaults to `warn`, and dropped entirely below `review.min_confidence`. Three independent mechanisms, each sufficient alone.

So `--mode gate` is bit-for-bit reproducible and can be a required status check. Review adds comments, which a human reads and judges — and a comment being occasionally wrong costs thirty seconds, not a blocked release.

You can raise a `review/*` rule to `error` and let AI findings block merges. We think you should not, at least not until you have months of evidence about your own false-positive rate.

## What about false positives?

They are the main risk to the product. A reviewer you stop trusting is worse than no reviewer. Five defences:

1. **Comment cap.** `review.max_comments` defaults to 5. Five comments somebody reads beats ninety nobody does.
2. **Confidence floor.** `review.min_confidence` defaults to 0.7; below it, findings are dropped rather than downgraded. Raise it to 0.85 if review is noisy.
3. **Severity capping.** AI findings cannot block merges under the default configuration.
4. **The baseline.** Existing findings are counted, never commented. A PR only hears about what it introduced.
5. **Suppression that is precise.** `gribble ignore <fp>` kills one finding on one route, not a whole rule.

And a sixth, less mechanical one: a recurring false positive usually means an ambiguous [guideline](/docs/guidelines). Sharpening the sentence fixes it better than an ignore does. A `## What not to flag` section in `guidelines.md` is a legitimate and effective tool.

Development is also evaluated against a deliberately broken reference site with dozens of known defects, and every prompt or model change is measured on it for both recall and false positives.

## Why doesn't the model look at screenshots by default?

Because text beats pixels for almost everything.

Given the DOM, the model knows the exact hex colour, the exact font size in pixels, the exact accessible name, whether a button has a label, and what a form field is called. Given a PNG, it is guessing at all of them — and models are noticeably bad at exactly this kind of precise visual judgement.

So `page_snapshot` returns a simplified DOM, an aria snapshot, bounding boxes, and overlap, overflow and design-token violations **already computed in code**. Screenshots are still taken for pixel-diff regression (done in code) and for humans to look at.

Set `review.vision: true` to hand the model the `screenshot` tool for the cases where data genuinely cannot say: canvas rendering, image content, a chart that looks wrong. It costs more and lets you use a vision model rather than any tool-calling model.

## Does Gribble work on Windows?

Yes. Node 22, Playwright and Gribble all run on Windows, and CI runs a Windows matrix.

Two practical notes. Your `target.start` command runs through the platform shell, so a command with Unix-only syntax needs a cross-platform equivalent — usually the package script you already have. And paths inside reports and baselines are stored with forward slashes regardless of platform, so a baseline committed on macOS compares correctly against a run on Windows. Mixed-platform teams need no special configuration.

## Can Gribble audit my iOS or Android app?

Not yet. Mobile apps are phase two.

The plan is to swap the browser engine for Appium or Maestro while keeping everything above it — flows, rules, guidelines, findings, fingerprints, baselines, the comment lifecycle and the report format. That layer is already engine-agnostic; the work is the driver underneath.

What works today is your mobile **web** experience: the `mobile` viewport is audited by default at 390×844, with a real mobile viewport in a real browser, and rules like `ui/horizontal-overflow` default to mobile-only because that is where it happens.

## Where does my data go?

Nowhere. There is no Gribble cloud, no Gribble account, no telemetry and no server of ours in the path.

Your pages, screenshots, source code and reports stay on the machine running the audit. The only network traffic Gribble originates is your dev server or preview URL, external links it checks for `links/broken-external`, and — in review mode — **your** model provider, called directly with **your** API key and billed to you.

Credentials live in `~/.gribble/auth.json` on your machine (or `~/.pi/agent/` with `reusePiAuth`). Site credentials are environment variables you set, named but never stored in config, and redacted from session logs and reports.

Practical caution: review mode does send page content to your model provider. If your staging environment contains real customer data, either use synthetic data — which you should be doing anyway — or run `--mode gate`, which never contacts a model.

Report JSON is designed to be self-contained and uploadable so a hosted dashboard stays possible later. Uploading would be an explicit choice you make, not a default.

## Which model should I use?

Run `gribble models`. It lists what your credentials can reach, with recommended options first, and you write the one you pick into `gribble.yaml`.

The recommended set favours reliable tool calling, no vision requirement (the agent reads structured snapshots) and a price that survives running on every pull request. Gribble deliberately hardcodes no model name in its code or documentation: any specific recommendation would be stale within months. The table lives in one file in the source and is refreshed each release.

Commit the model. Your whole team and CI then run the same audit, and `review/*` findings stay comparable across runs. The model is recorded in `baseline/meta.json` too, because a wave of new AI findings on an unrelated PR is usually explained by somebody changing it.

## Why build on pi?

Gribble needs an agent loop, a multi-provider model catalogue with pricing, credential storage with OAuth and API keys, a tool-definition system, and a session format that records every call and result. All of that is undifferentiated infrastructure, and [pi](https://github.com/earendil-works/pi) already has it, with a real SDK meant to be embedded.

Gribble is a shell around pi rather than a pi extension: it imports the SDK and calls `createAgentSession()` directly, no subprocess and no RPC. That leaves us owning the parts that are actually Gribble — the browser and audit tools, the deterministic checks, the guardrails, the report format and the baseline machinery — and it means every model pi supports works here on day one.

pi's session file is also a complete audit trace, which is what the local replay UI will read.

Practical consequences for you: Node 22 or newer, `gribble login` uses pi's auth storage, `model` uses pi's `provider/id:thinking` syntax, and `reusePiAuth: true` lets existing pi users skip a second login.

## Will Gribble solve CAPTCHAs or get past 2FA?

No, and this is not a missing feature.

Defeating a bot check is exactly the behaviour those checks exist to prevent, and an agent that will do it on your instruction is an agent that will do it on a web page's instruction. Ours does not.

The workable options are all better anyway: disable the check in staging (most teams already do for their E2E suite), add a dev-only login endpoint behind an environment flag and call it from a `command` [auth profile](/docs/auth#command), or inject a session with a `cookie` or `header` profile. See [Auth](/docs/auth#no-captcha-no-2fa-bypass).

## Do I need a model at all?

Not for `--mode gate`. Broken links, network failures, console errors, SEO, axe accessibility, Lighthouse thresholds, HTML sanity, security checks, UI hard rules, flow replay and all three regression rules run as plain code.

That is a genuinely useful product on its own, and it is a sensible way to adopt Gribble: gate in CI from day one, review locally where you already have a subscription, and turn on review in CI when you have decided it is worth an API key.

## How long does an audit take?

Depends on route count, but rough orders of magnitude on a small site: gate is seconds to a couple of minutes, dominated by Lighthouse, which is the slow part per route. Review adds minutes, depending on how many flows there are and how much exploring it does.

Levers if it is too slow: `--changed` to audit only affected routes, an explicit `target.routes` list instead of `auto` on a site with hundreds of generated pages, fewer viewports (each one multiplies screenshot and Lighthouse work), `review.explore: false` to keep review to your written flows, and `budget.max_steps` as a hard ceiling.

## Can I use Gribble on a site somebody else runs?

Technically it will point anywhere `allowed_origins` permits. Do not.

Gribble drives a real browser through real journeys, submits forms, and runs Lighthouse repeatedly. On infrastructure you do not own that is unsolicited automated load at best. `allowed_origins` defaults to nothing beyond your target host specifically to make wandering hard.

Audit your own development, preview and staging environments. Auditing your own production is legitimate but read-only in spirit — expect the guardrails to block form submissions on a non-staging host, which is the intended behaviour, not a bug.

## My PR comments disappeared. What happened?

Most likely one of three things.

The pull request is **from a fork**, so GitHub gave the workflow a read-only token and comments cannot post. The audit still ran and the artifact still uploaded.

The run was a **bootstrap** — no baseline existed, so Gribble recorded the current state instead of reporting it. Commit `.gribble/baseline/` and the next run is a real diff.

Or the findings were all **existing**: already in the baseline, so counted in the summary and deliberately not commented on. That is the diff-not-score principle working, not a failure.

If a comment vanished rather than never appearing, that is the [lifecycle](/docs/concepts/findings#comment-lifecycle) doing its job: a fingerprint that disappears gets its comment edited to "patched ✅" and its thread resolved.
