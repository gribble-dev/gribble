---
title: Getting started
description: Install Gribble, run init, and get your first audit and baseline.
order: 10
---

This page takes you from an empty project to a first audit and a committed baseline. Budget about ten minutes, most of which is the browser download. The quickest way aboard is to let your coding agent do the rigging; everything it does is also written out [by hand](#by-hand) below.

## With your agent

Open your coding agent (Claude Code, Cursor, pi, Codex, …) in the project and give it one sentence:

```prompt
Set up Gribble in this project by following https://gribble.dev/setup.md
```

It follows the [Agent setup guide](/docs/agent-setup), which tells it to:

1. Work out the package manager, which app is the website, its dev command and its local URL.
2. Install `gribble` as a devDependency, download the browser, and add the review runtime unless you only want `gate`.
3. Run `gribble init --yes` with the URL and start command it found, which also installs the [Gribble skill](/docs/skills) for the agents in your repository.
4. Run a first `gate` audit, which records the [baseline](#the-bootstrap-run).
5. Report every command it ran, every file it changed, and the most severe findings.

Two things it stops and asks you about, because only a person should decide them:

- **Which model.** It runs `gribble models`, shows you the recommended ones your credentials can reach, and writes your pick to `model:` in `gribble.yaml`. It never makes up a model name.
- **Credentials.** If no model is reachable, it asks you to run `gribble login` in your own terminal, or to export your provider's API key. It does not run `login` for you and never writes a key into the repository. Until then it carries on with `gate` only.

It does not fix findings, add CI or commit anything until you ask. When it is done, skip ahead to [Next steps](#next-steps).

## By hand

The rest of this page is the same setup, one command at a time.

## Prerequisites

- **Node.js >= 22.** Gribble is ESM-only and pi requires it.
- **A package manager** — pnpm, npm or yarn all work.
- **A dev server or a preview URL.** Gribble can start your dev server for you (`target.start`) or point at a URL that is already up.
- **A model provider credential** for `review` mode — an API key, or a subscription you log in to. `gate` mode runs without any model at all, and without the packages that would talk to one.

## Install

Install Gribble as a devDependency, the way you would ESLint or Playwright. It is not meant to be a global tool: the version belongs in your lockfile so CI and your laptop agree.

```bash
pnpm add -D gribble
# npm install --save-dev gribble
# yarn add --dev gribble
```

### The review runtime is optional

That install gives you the deterministic half and nothing else. The AI half — pi's agent loop, model catalog and the provider SDKs behind it — ships as **optional peer dependencies**, so a fresh install for `--mode gate` in CI brings no model runtime at all: no provider SDKs, no cloud credential chain, roughly 120 fewer packages. Upgrading from 0.3 with pnpm is the exception; see [below](#upgrading-from-0-3).

For `review` or `all`, add the two runtime packages next to Gribble:

```bash
pnpm add -D gribble @earendil-works/pi-ai @earendil-works/pi-coding-agent
# npm install --save-dev gribble @earendil-works/pi-ai @earendil-works/pi-coding-agent
# yarn add --dev gribble @earendil-works/pi-ai @earendil-works/pi-coding-agent
```

No package manager installs an optional peer on its own — on a fresh install npm, pnpm, yarn and bun all skip it — so this step is always explicit. Gribble pins one exact pi version and both packages must match it; reach `review` without them and the CLI stops with the exact `npm install` line, version included, instead of a module-resolution stack trace.

### Upgrading from 0.3

Gribble 0.3 shipped the review runtime as a hard dependency. With pnpm, bumping to 0.4 does not remove it: pnpm resolves the new optional peers against what the lockfile already holds, finds the runtime from 0.3 there, and keeps it — along with the provider SDKs and the AWS credential chain behind it. `pnpm install` answers `Already up to date`, and `pnpm dedupe` leaves it too. Gate-mode audits say so with a warning.

If you use `review` or `all`, that is fine: add the two packages to your devDependencies as above, so the lockfile keeps them on purpose. If you only run `gate`, check whether the runtime is still there after the bump:

```bash
pnpm why @earendil-works/pi-ai
```

No output means it is gone. If it is listed under `gribble`, re-resolve without it. Either:

- **Turn off `autoInstallPeers` for one install.** Set `autoInstallPeers: false` in `pnpm-workspace.yaml` (or `auto-install-peers=false` in `.npmrc` on pnpm 9), run `pnpm install`, then remove the setting and run `pnpm install` again. The runtime does not come back, because a fresh resolution never auto-installs an optional peer. The first install also re-resolves every other peer your project relies on pnpm to add automatically, so read the lockfile diff before committing it. Leaving the setting at `false` is not a fix: it is a different dependency graph.
- **Regenerate the lockfile.** Delete `pnpm-lock.yaml` and `node_modules`, then `pnpm install`. This re-resolves everything else in the project as well, within the ranges in your `package.json` files.

`pnpm remove gribble && pnpm add -D gribble` does not help; the runtime is resolved again from the lockfile. Neither does an `overrides` entry for the pi packages, which leaves the provider SDKs behind or the lockfile unchanged depending on the pnpm version.

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

Once the baseline is committed, most of the day-to-day work is a sentence to your coding agent. Some good first ones:

```prompt
Fix the new Gribble findings from the latest audit, most severe first, and verify each fix with a gate audit.
```

```prompt
Add a Gribble flow for our checkout: a signed-in user adds a product to the cart, goes to checkout and sees a total that matches the cart, stopping before payment.
```

```prompt
Add the Gribble GitHub Action so every pull request is audited and gets a comment on new findings, reading the model API key from a repository secret.
```

Or read up first:

- Loosen or tighten the checks in [rules.yaml](/docs/configuration/rules-yaml).
- Write your first [flow](/docs/flows) so review mode knows what "checkout" means in your app.
- Put your house style into [guidelines.md](/docs/guidelines).
- Add the [GitHub Action](/docs/ci-github-action) so every PR gets a comment.
- See [Working with your agent](/docs/skills) for more of what you can ask.
