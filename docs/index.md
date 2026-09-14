---
title: Gribble
description: An AI website quality audit agent that runs while you build, not after you ship.
order: 0
---

Gribble is a website quality audit agent that runs **during development** — before you open a pull request, inside CI, and before a release. It walks your site the way a picky reviewer would: it follows the links, walks the flows you described, checks SEO, accessibility, performance, security and your own house rules, and points every finding at the source file that caused it.

```bash
pnpm add -D gribble
pnpm exec gribble install   # downloads the Playwright browser
pnpm exec gribble init      # creates .gribble/
pnpm exec gribble audit     # let the gribbles chew on it
```

## Why the name

A gribble is a tiny marine isopod that bores holes into ship hulls from places nobody looks at. Whole piers have quietly collapsed because of them. We named the pest hunter after the pest: tiny bugs that find your bugs before you ship.

The "ship" pun is the house joke, and we are not sorry.

## Not a production site auditor

Tools like Ahrefs Site Audit, Screaming Frog or a scheduled Lighthouse run point at a site that is **already live**. They tell you what your users are seeing right now. That is useful, and Gribble does not replace it.

Gribble points at `localhost:3000`, at your Vercel preview URL, at the container your compose file just brought up. It runs on a branch, against code that has not merged yet, and its job is to stop a regression from reaching the live site in the first place.

| | Production auditors | Gribble |
| --- | --- | --- |
| Target | The deployed site | A dev server, preview URL or container |
| Cadence | Scheduled crawls | Every PR, every push, before release |
| Output | Dashboards and scores | PR comments, check annotations, a JSON report |
| Fix loop | File a ticket | Points at the source file; your coding agent fixes it |

## Two modes

Gribble runs two very different kinds of check, and the difference matters because only one of them is allowed to block a merge.

**[gate](/docs/concepts/gate-and-review)** is deterministic. Plain code, no model: broken links, failed requests, console errors, SEO metadata, axe accessibility violations, Lighthouse thresholds, HTML sanity, security checks, replay of flows that were already fixed in place. Fast, reproducible, same answer every time. Gate findings can fail your build.

**review** is the AI agent. It explores the site, walks the flows in `.gribble/flows/*.md`, looks for new flows nobody wrote down, judges the UI against your `.gribble/guidelines.md`, and writes fix suggestions. Slow, non-deterministic, and **never blocks a merge** — it comments. AI findings are capped in severity by your `review/*` rules, which default to `warn`.

Run both with `gribble audit`, or pick one with `--mode gate` / `--mode review`.

## Three entry points

All three consume the same audit and the same report.

1. **[CLI](/docs/cli)** — `gribble audit`, with a live event stream in your terminal and `--ci` for machine-readable output.
2. **[GitHub Action](/docs/ci-github-action)** — `uses: gribble-dev/action@v1`. Check runs with annotations, PR comments that update in place, SARIF for code scanning, JUnit, and the run directory as an artifact.
3. **Local web UI** — tracked in the [repository issues](https://github.com/gribble-dev/gribble/issues). It will stream the same event bus to a browser next to a live view of the page the agent is driving, so you can replay exactly what it did when a finding was raised.

## Diff, not score

Gribble does not hand you a number out of 100. A number out of 100 on an established codebase is a number everybody learns to ignore.

Everything is a **diff against the [baseline](/docs/concepts/baseline)** stored on your main branch:

- **New** findings are reported and commented on. These are the ones your change introduced.
- **Existing** findings are counted and never commented on. You already know.
- **Fixed** findings are celebrated in the summary. Somebody patched a hole.

Performance works the same way: `perf/regression` compares against the metrics your main branch recorded, so a slow legacy app is perfectly usable with Gribble as long as it stops getting slower.

## Built on pi, keyed by you

Gribble is a shell around [pi](https://github.com/earendil-works/pi). The agent loop, the model catalog, the provider auth and the session format come from pi's SDK; the browser tools, the deterministic checks, the guardrails and the report format come from Gribble. We do not maintain our own agent loop, and we do not patch pi.

Consequences worth knowing up front:

- **Bring your own key.** Gribble has no cloud, no account and no server of ours in the path. You log in to a model provider with `gribble login`, or you set an API key environment variable in CI. Your pages, your screenshots and your source never touch infrastructure we run.
- **No hardcoded model.** Gribble does not ship a default model name. `gribble init` shows you what your credentials can reach, with a recommended set first, and writes your choice into `gribble.yaml` so your whole team reproduces the same audit.
- **The session file is the trace.** Every tool call, argument and result is recorded in `.gribble/sessions/` (gitignored), which is what the replay UI will read.
- **Read-only by default.** The agent gets read, grep, find, ls and Gribble's audit tools. No `edit`, no `write`, no `bash`.

Licensed MIT. The report JSON is designed to be self-contained and uploadable, so a hosted dashboard stays possible later — but there is nothing to sign up for today.

## Where to go next

- **[Getting started](/docs/getting-started)** — install, init, first audit, what to commit.
- **Concepts** — [gate and review](/docs/concepts/gate-and-review), [the baseline](/docs/concepts/baseline), [findings and fingerprints](/docs/concepts/findings).
- **Configuration** — [gribble.yaml](/docs/configuration/gribble-yaml), [rules.yaml](/docs/configuration/rules-yaml), [the rules reference](/docs/configuration/rules-reference).
- **[Flows](/docs/flows)** — describe user journeys in Markdown and replay them deterministically.
- **[Guidelines](/docs/guidelines)** — the house rules a model has to read, not a linter.
- **[Auth](/docs/auth)** — logging in to the site under test, and to your model provider.
- **[CI and the GitHub Action](/docs/ci-github-action)** — the workflow, inputs, outputs and permissions.
- **[Monorepos](/docs/monorepos)** — one `.gribble/` per app, cascading rules.
- **[Skills for coding agents](/docs/skills)** — teach Claude Code, pi or Cursor to fix what Gribble finds.
- **[CLI reference](/docs/cli)** — every command, flag and exit code.
- **[Report format](/docs/report-format)** — the JSON, SARIF and JUnit outputs.
- **[FAQ](/docs/faq)** — cost, false positives, privacy, Windows, and why not Lighthouse CI.
