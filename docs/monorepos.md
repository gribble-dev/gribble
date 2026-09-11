---
title: Monorepos
description: One .gribble/ per app, with rules and guidelines cascading up to the repository root.
order: 51
---

A repository with several web apps needs several audits: each app has its own URL, its own routes, its own journeys and its own baseline. What it does not need is several copies of the same accessibility policy.

Gribble's answer is the one ESLint and TypeScript already taught everybody: **one config unit per app, cascading upward for the shared parts.**

## One `.gribble/` per app

```
my-monorepo/
  .gribble/
    rules.yaml            shared rules
    guidelines.md         shared guidelines
                          (no gribble.yaml — the root is not an app)
  apps/
    web/
      .gribble/
        gribble.yaml      url, start, model, budgets
        rules.yaml        app-specific rule adjustments
        guidelines.md     app-specific guidelines
        flows/
        baseline/
    admin/
      .gribble/
        gribble.yaml
        rules.yaml
        flows/
        baseline/
  packages/
    ui/                   no .gribble/ — not a site
```

The root `.gribble/` holds **only shared rules and guidelines**. It has no `gribble.yaml`, no target, no flows and no baseline, because there is no site at the repository root to audit. Gribble identifies auditable apps by the presence of a `gribble.yaml`.

Run `gribble init` inside each app directory. There is no separate setup step for the root — create `.gribble/rules.yaml` there when you have something to share, and not before.

## Cascading

Walking from an app's `.gribble/` up to the repository root, Gribble collects config files and combines them.

### `rules.yaml` merges, child wins

Root:

```yaml
# .gribble/rules.yaml
extends:
  - gribble:recommended

rules:
  a11y/color-contrast: [error, { level: AA }]
  ui/colors-from-tokens: error
  seo/twitter-card: off
```

App:

```yaml
# apps/admin/.gribble/rules.yaml
rules:
  seo/*: off                      # an internal tool does not need SEO
  perf/lighthouse-performance: off
  a11y/color-contrast: error      # inherited; restated for clarity

overrides:
  - routes: ["/reports/**"]
    rules:
      perf/page-weight: off       # report pages are legitimately heavy
```

`apps/admin` ends up with `gribble:recommended`, plus the company-wide contrast and design-token rules, minus SEO and the Lighthouse threshold, with a further exception on report routes. Root first, app last, and the more specific setting wins. `overrides` accumulate, later entries taking precedence — so an app-level override beats a root-level one for the same route.

`ignore` lists concatenate. A fingerprint suppressed at the root is suppressed everywhere; app-level fingerprints only apply to that app, which is the correct behaviour since fingerprints include the target name.

### `guidelines.md` concatenates, root first

Prose has no keys, so there is nothing to override. The files are joined in order, root first, into one document the model reads.

```
.gribble/guidelines.md              company voice, terminology, a11y stance
apps/admin/.gribble/guidelines.md   admin specifics and exceptions
```

Because later text settles arguments in practice, use the app file to narrow:

```md
# Admin guidelines

Extends the root guidelines. Where they conflict, this file wins.

- The root rule about warm, welcoming copy does not apply here. Admin copy is
  terse and assumes an expert user.
- Density is a feature. Do not report compact tables as cramped.
```

See [Guidelines](/docs/guidelines#monorepo-concatenation).

### What does not cascade

- **`gribble.yaml`** — each app's settings are its own. A URL, a start command and a budget are not shareable things.
- **`flows/`** — a checkout journey in `apps/shop` is meaningless in `apps/admin`.
- **`baseline/`** — per app, obviously.

## Commands

```bash
# inside an app
cd apps/web && gribble audit

# from the repository root
gribble audit --target apps/web

# every app in the repo
gribble audit --all
```

`--all` discovers every `.gribble/` containing a `gribble.yaml` and audits each in turn. It is the right default for CI and for nightly runs; `--target` is what you want while working on one app.

Each app's report is written to its own `.gribble/runs/`, and `--all` prints a combined summary. With `--ci`, the JSON on stdout carries one report per target.

## Fingerprints include the target

A finding's [fingerprint](/docs/concepts/findings#fingerprints) includes the target name — `apps/web`, `apps/admin` — so the same missing alt attribute in two apps produces two distinct findings, two baseline entries and two comments. Fixing one does not silently mark the other as patched.

For a single-app repository the target name is empty, so fingerprints in a repo that later becomes a monorepo will change when the app moves into `apps/`. Re-baseline after that move; it is a one-time cost.

## Incremental audits and the dependency graph

`--changed` uses the git diff to decide what to audit. In a monorepo it also uses the **workspace dependency graph**, the same way `pnpm --filter ...[origin/main]` does: a change in `packages/ui` affects every app that depends on it, so every one of those apps is audited, while apps that do not depend on it are skipped.

```bash
gribble audit --all --changed
```

Within each affected app, only the routes the change can touch are audited, and only those routes are compared against the baseline. Routes nobody visited keep their existing findings and metrics untouched — they are not reported as fixed just because nobody looked.

Full audits belong in nightly runs and before releases.

## In CI

One job, every app:

```yaml
      - uses: gribble-dev/action@v1
        with:
          all: true
```

The PR summary comment is sectioned per app, and each per-finding comment carries its own fingerprint marker, so the [comment lifecycle](/docs/concepts/findings#comment-lifecycle) works across apps without interference.

Split into a matrix if your apps have very different setup requirements or you want independent status checks:

```yaml
    strategy:
      matrix:
        app: [apps/web, apps/admin]
    steps:
      - uses: gribble-dev/action@v1
        with:
          target: ${{ matrix.app }}
```

The trade-off: a matrix gives you parallelism and separate required checks, but each job posts its own comments, so a PR touching three apps gets three summary comments instead of one sectioned summary. Start with `all: true`.

## Installation and skills

Install Gribble **once, at the repository root**:

```bash
pnpm add -D -w gribble
```

Not per app. The `gribble` binary finds the right `.gribble/` from your working directory or from `--target`.

Install the [coding-agent skill](/docs/skills) once too, at the root `.agents/skills/` (or `.claude/skills/`, depending on your agent). The skill reads `.gribble/runs/latest.json` relative to whichever app it is working on, so one installation serves every app.

```bash
pnpm exec gribble init --update-skills
```

## Adding a new app

1. `cd apps/newthing && pnpm exec gribble init` — answer the URL and start command; the model question inherits what your other apps use.
2. Delete anything from the generated `rules.yaml` that the root already says. The generated file starts from `gribble:recommended`; if your root already extends it, the app file can often be trimmed to nothing.
3. Run `gribble audit` once. No baseline exists, so it [bootstraps](/docs/concepts/baseline#bootstrap-mode).
4. Commit `.gribble/` including `baseline/`.

The new app is now in `--all` runs, with its own ledger and no effect on anybody else's.

## Recommended split

A rough guide to what goes where:

| Root `.gribble/` | App `.gribble/` |
| --- | --- |
| `extends: [gribble:recommended]` | The target URL and start command |
| Accessibility commitments | The model and budgets |
| Design-token rules | Route list or discovery mode |
| Company voice and terminology | App-specific rule exceptions |
| Security expectations | Flows |
| Fingerprints suppressed everywhere | The baseline |

If the root file starts collecting per-app exceptions, that is the signal to push them down into the app that needs them. A root config full of `overrides` keyed on one app's routes is a cascade being used backwards.
