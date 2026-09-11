---
title: Getting started
description: Install Gribble, run init, and get your first audit and baseline.
order: 10
---

This page takes you from an empty project to a first audit and a committed baseline. Budget about ten minutes, most of which is the browser download.

## Prerequisites

- **Node.js >= 22.** Gribble is ESM-only and pi requires it.
- **A package manager** — pnpm, npm or yarn all work.
- **A dev server or a preview URL.** Gribble can start your dev server for you (`target.start`) or point at a URL that is already up.
- **A model provider credential** for `review` mode — an API key, or a subscription you log in to. `gate` mode runs without any model at all.

## Install

Install Gribble as a devDependency, the way you would ESLint or Playwright. It is not meant to be a global tool: the version belongs in your lockfile so CI and your laptop agree.

```bash
pnpm add -D gribble
# npm install --save-dev gribble
# yarn add --dev gribble
```

Then fetch the browser binary:

```bash
pnpm exec gribble install
```

This runs Playwright's Chromium download. If your CI image already has Playwright browsers (or you use the [Docker image](/docs/ci-github-action#docker-image)), you can skip it there.

## `gribble init`

```bash
pnpm exec gribble init
```

> Let's put some gribbles in your repo.

The walkthrough asks four things.

**1. Where does your site live?** The URL Gribble should audit, defaulting to `http://localhost:3000`. You can type an environment variable reference like `${PREVIEW_URL}` instead of a literal URL.

**2. How does it start?** An optional command such as `pnpm dev`. If you give one, Gribble runs it before each audit and waits until the URL responds (120 seconds by default). Leave it blank if you always point at something that is already running.

**3. Which model?** Gribble asks your model runtime which models your current credentials can actually reach, then sorts them with a **recommended set first** — models that handle tool calling well, do not need vision, and are cheap enough to run on every PR. Pick one and it is written into `gribble.yaml` so your whole team reproduces the same audit. If you have no credentials yet, init offers to run [`gribble login`](/docs/auth#part-2-model-provider-auth) first.

Gribble deliberately ships no default model name. The recommended table lives in one place in the source and is refreshed every release.

**4. Should we teach your coding agent?** 

> Teach your coding agent to feed the gribbles?

Init looks for `.claude/`, `.pi/`, `.cursor/` and `AGENTS.md` and offers to install the [Gribble skill](/docs/skills) into each agent it finds. The skill teaches your coding agent to read the latest report, fix findings by severity, verify with `gribble audit --mode gate`, and keep your flows and rules up to date.

Pass `--yes` to accept every default, including installing the skill everywhere. Pass `--url`, `--start` and `--model` to answer individual questions non-interactively.

## Log in to a model provider

```bash
gribble login                    # pick a provider interactively
gribble login <provider>         # OAuth flow or API key prompt
gribble login <provider> --api-key "$MY_KEY"
```

Credentials go to `~/.gribble/auth.json`, never into your repository. If you already use pi, set `reusePiAuth: true` in `gribble.yaml` and Gribble reads `~/.pi/agent/` instead of keeping a second copy.

Gribble also picks up the standard provider environment variables, which is how CI is expected to work:

```bash
# whichever provider you chose; e.g.
export ANTHROPIC_API_KEY=...
export OPENAI_API_KEY=...
export GOOGLE_API_KEY=...
```

**Subscription OAuth logins are personal.** Do not try to move one into CI — use an API key there. See [Auth](/docs/auth#part-2-model-provider-auth).

## Your first audit

```bash
pnpm exec gribble audit
```

You get a live event stream: the dev server coming up, routes being discovered, deterministic checks running per route, then the agent exploring.

```
🪱 3 gribbles are nibbling on localhost:3000…
   ✓ routes        12 discovered
   ✓ links         248 checked
   ✓ a11y          12 routes
   ✓ perf          12 routes
   … reviewing /pricing
```

And then one of two endings:

```
The gribbles went hungry. Ship it.
```

```
The gribbles found 4 holes in your hull — 2 need patching before you sail.

  error    links/broken          /pricing     → /docs/plans returns 404
  error    a11y/form-labels      /signup      Input #email has no associated label
  warn     seo/meta-description  /blog/[slug] 22 characters, minimum is 50
  warn     review/copy           /pricing     "Contact sales" and "Talk to sales" on the same page
```

Findings are dry on purpose. The jokes stop where the bug begins.

Exit codes: `0` everything passed, `1` the gate failed, `2` a config or auth problem. See the [CLI reference](/docs/cli#exit-codes).

## The bootstrap run

The first audit has nothing to compare against, so Gribble enters **bootstrap mode**: it records what it finds as the known state instead of reporting it as new, writes `.gribble/baseline/`, posts no PR comments, and tells you to commit the result.

```
No baseline yet — this run is the baseline. 18 findings recorded as known.
Commit .gribble/baseline/ so future runs have something to diff against.
```

From then on, every run is a diff: new findings get reported, existing ones get counted, fixed ones get celebrated. See [Baseline](/docs/concepts/baseline).

## What `.gribble/` contains

```
.gribble/
  gribble.yaml      project settings: URL, start command, model, budgets   (commit)
  rules.yaml        rule severities, ESLint style                          (commit)
  guidelines.md     judgement-call house rules for the review AI           (commit)
  flows/            user journeys in Markdown, plus replay sidecars        (commit)
  baseline/         known findings, metrics, aria snapshots, screenshots   (commit)
  .gitignore        generated; ignores runs/ sessions/ cache/              (commit)
  runs/             reports, traces and screenshots per audit              (ignored)
  sessions/         pi session files = full audit traces for replay        (ignored)
  cache/            incremental audit cache, auth storage state            (ignored)
```

### What to commit

Commit everything except `runs/`, `sessions/` and `cache/` — and you do not have to do anything to arrange that, because `gribble init` writes `.gribble/.gitignore` for you:

```
runs/
sessions/
cache/
```

That file is self-contained and is itself committed. `gribble init` **never touches your repository root `.gitignore`**. It only warns you if your root `.gitignore` already ignores the whole `.gribble/` directory, because that would also throw away your rules, flows and baseline:

```
Your root .gitignore ignores .gribble/ entirely.
That also ignores rules.yaml, flows/ and baseline/, which should be committed.
```

`sessions/` and `cache/` are ignored for a reason beyond noise: session files record tool arguments (screenshots, test-account data) and `cache/auth/` holds browser storage state for logged-in profiles. Keep them out of git. In CI, reports travel as [artifacts](/docs/ci-github-action#artifacts), not commits.

## Next steps

- Loosen or tighten the checks in [rules.yaml](/docs/configuration/rules-yaml).
- Write your first [flow](/docs/flows) so review mode knows what "checkout" means in your app.
- Put your house style into [guidelines.md](/docs/guidelines).
- Add the [GitHub Action](/docs/ci-github-action) so every PR gets a comment.
