---
title: Agent setup guide
description: Step-by-step instructions a coding agent follows to add Gribble to a project. Also served at gribble.dev/setup.md.
order: 11
---

This page is written for coding agents. Hand it to yours with one sentence and it does the install, the configuration and the first audit, then stops and asks you for the two things only a person should decide.

```prompt
Set up Gribble in this project by following https://gribble.dev/setup.md
```

The same page is served as plain Markdown at [`gribble.dev/setup.md`](https://gribble.dev/setup.md) and ships inside the npm package at `node_modules/gribble/docs/agent-setup.md`. The rest of this page speaks to the agent.

## Before you start

You are adding Gribble, a website quality audit CLI, to the project in the current working directory. It runs against a dev server or preview URL, reports findings that point at source files, and diffs every run against a committed baseline. The full documentation is at <https://gribble.dev/docs> (append `.md` to any page URL for raw Markdown) and, once installed, at `node_modules/gribble/docs/`.

Ground rules for this task:

- **Do not invent a model name.** Gribble ships no default model. Only use an id that `gribble models` printed.
- **Never put a credential in the repository.** No API key in `gribble.yaml`, `.env` files you commit, or workflow files. Secrets go in environment variables or the CI secret store.
- **Do not run `gribble login` for the user.** It opens an interactive OAuth or API key prompt. Ask the user to run it.
- **Do not suppress findings.** No `ignore` entries in `rules.yaml` and no `gribble ignore` without the user agreeing to each one.
- **Report what you ran.** List every command and every file you created or changed when you finish.

## 1. Find the app

Work out, from the repository itself:

| Question | Where to look |
| --- | --- |
| Package manager | The lockfile: `pnpm-lock.yaml` → pnpm, `package-lock.json` → npm, `yarn.lock` → yarn, `bun.lock` / `bun.lockb` → bun |
| Which app is the website | In a monorepo, the workspace with a web framework dependency (Next.js, SvelteKit, Astro, Nuxt, Remix, Vite, …). If there are several, ask the user which ones to audit. |
| Dev command | The `dev` (or `start`) script in that app's `package.json` |
| Local URL and port | The framework default, or a `--port` flag / `server.port` setting in the script or framework config |
| Node.js version | `node --version` must print 22 or newer. If it does not, stop and tell the user. |

Run every command below from the app's directory (in a monorepo, the directory whose `package.json` has the dev script). See [Monorepos](/docs/monorepos) if there is more than one app.

## 2. Install

Install Gribble as a devDependency with the project's package manager. pnpm is shown; translate for the others (`npm install --save-dev`, `yarn add --dev`, `bun add --dev`).

```bash
pnpm add -D gribble
pnpm exec gribble install
```

`gribble install` downloads Playwright's Chromium. It can take a minute.

This gives the deterministic `gate` mode only. The AI `review` mode needs two optional peer packages, which no package manager installs on its own. Add them unless the user said they only want `gate`:

```bash
pnpm add -D @earendil-works/pi-ai @earendil-works/pi-coding-agent
```

If the versions do not match what Gribble expects, the CLI prints the exact install line to use. Run that line.

## 3. Initialise

Run `init` non-interactively, answering from what you found in step 1:

```bash
pnpm exec gribble init --yes --url http://localhost:5173 --start "pnpm dev"
```

- `--url` is the local URL of the running app. A preview URL from an environment variable is written as `'${PREVIEW_URL}'`.
- `--start` is the command that brings the app up. Leave it out if the user always runs the server themselves.
- `--yes` accepts every other default and installs the Gribble skill for every coding agent it detects (`.claude/`, `.pi/`, `.cursor/`, `AGENTS.md`). That skill teaches you and future sessions how to fix findings and edit flows and rules, so keep it.

`init` never overwrites existing `.gribble/` files unless you pass `--force`. If `.gribble/` already exists, stop and ask the user whether to keep or replace it.

## 4. Pick a model

```bash
pnpm exec gribble models
```

- **It lists models.** The recommended ones come first. Show the user the top few and ask which one to use, then write it to `model:` in `.gribble/gribble.yaml` (format `provider/id`). If credentials were already present, `init --yes` wrote the top recommended model there; ask anyway and replace it if the user picks another.
- **It lists nothing, or says no credentials were found.** Ask the user to either run `pnpm exec gribble login` in their own terminal or export their provider's API key (for example `ANTHROPIC_API_KEY`), then run `gribble models` again. Until then, continue with `gate` only.

## 5. First audit

```bash
pnpm exec gribble audit --mode gate
```

The first run has no baseline, so it **records** what it finds as the known state and writes `.gribble/baseline/`. That is expected: an established site always has some findings, and they are not failures of this setup. Exit code `2` means a config or startup problem (read the message; usually the URL or start command is wrong). See [Exit codes](/docs/cli#exit-codes).

If a model is configured, follow up with the full run:

```bash
pnpm exec gribble audit
```

## 6. Hand back to the user

Stop here and report:

1. The commands you ran and the files that changed. Expect `package.json`, the lockfile, `.gribble/` and one or more `skills/gribble/SKILL.md` files.
2. What goes into git: everything in `.gribble/` except `runs/`, `sessions/` and `cache/`, which the generated `.gribble/.gitignore` already excludes. Do not edit the root `.gitignore`.
3. The finding counts from `.gribble/runs/latest.json` (`summary.counts`) and the three most severe findings, dry and precise: rule, route, file.
4. What the user can ask for next, as short prompts:
   - "Fix the new Gribble findings and verify with gate."
   - "Add a flow for the sign-up journey."
   - "Add the Gribble GitHub Action to this repo."

Do not fix findings, add CI, or commit anything unless the user asks.

## Optional follow-ups

When the user asks for one of these, read the linked page first; each one starts with the prompt that got you there.

| Request | Read |
| --- | --- |
| Run Gribble on every pull request | [CI and the GitHub Action](/docs/ci-github-action) or [GitLab CI](/docs/ci-gitlab) |
| Describe a user journey to walk | [Flows](/docs/flows) |
| Tighten or loosen a check | [rules.yaml](/docs/configuration/rules-yaml) |
| Encode a house style the model should judge | [Guidelines](/docs/guidelines) |
| Audit pages behind a login | [Auth](/docs/auth) |
| Understand the numbers | [Baseline](/docs/concepts/baseline) and [Findings](/docs/concepts/findings) |
