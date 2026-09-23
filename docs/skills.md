---
title: Working with your agent
description: What to ask Claude Code, Cursor, pi or Codex once Gribble is in your repository, and the skill that teaches them how.
order: 12
---

Gribble finds problems. Something has to fix them. In most repositories that something is already a coding agent, and the fastest closed loop looks like this:

**Gribble audits → your agent reads the report → your agent fixes the findings → `gribble audit --mode gate` verifies → your agent updates the flows and rules it learned about.**

You steer that loop in plain sentences. The `@gribble/skills` package ships a skill file that teaches your agent every step of it, so none of the requests below need you to explain the tooling first. Not set up yet? Start with the [Agent setup guide](/docs/agent-setup).

## What you can ask

### Fix findings

```prompt
Fix the new Gribble findings from the latest audit, most severe first, and verify each fix with a gate audit.
```

```prompt
Gribble says the checkout flow replay is failing. Look at the latest report, find out why and fix it.
```

The agent reads `.gribble/runs/latest.json`, touches only findings with status `new`, follows each finding to its source file, and re-runs `gribble audit --mode gate` rather than declaring victory after the edit. For a finding it believes is wrong, it tells you and suggests a fingerprint to ignore; it does not ignore it.

### Add a flow

```prompt
Add a Gribble flow for the password reset journey: a user requests a reset link from /forgot-password, opens it, sets a new password and lands signed in on the dashboard.
```

You get a `.gribble/flows/password-reset.md` with a start URL, steps named by what a user sees, the outcomes that prove the journey worked, and `requires_auth` when it needs a login. The replay sidecar is recorded later by review, not written by the agent. See [Flows](/docs/flows).

### Turn a house rule into config

```prompt
No page should ship with "Coming soon" on it, and every error message must say what to do next. Add both to Gribble in whichever file each belongs.
```

The first is a pattern match, so it becomes an extra pattern for `ui/placeholder-text` in `rules.yaml`; the second needs a model to read the message, so it goes in `guidelines.md`. The agent knows the difference; the table [below](#how-the-skill-makes-that-work) is how it decides.

### Understand a finding

```prompt
Why is the missing alt text on /blog/[slug] listed as existing in the latest Gribble report, and when did it first show up?
```

`existing` means the finding is already in the committed [baseline](/docs/concepts/baseline), and `firstSeen` in `.gribble/baseline/findings.json` records the commit it arrived in. The agent explains; it does not fix `existing` findings unless you ask, because paying down old debt is a separate piece of work.

```prompt
Gribble keeps flagging our admin tables for contrast. Look at whether that rule should be scoped differently and propose a change, without applying it.
```

### Wire up CI

```prompt
Add the Gribble GitHub Action to this repository: audit every pull request and comment on new findings, refresh the baseline on pushes to main, and read the model provider API key from a repository secret.
```

The agent reads [CI and the GitHub Action](/docs/ci-github-action) (or [GitLab CI](/docs/ci-gitlab)) from the installed package, writes the workflow, and tells you which secret to create. It never writes a key into a file; creating the secret is yours to do.

A pattern worth adopting: run `gribble audit --mode gate` yourself, then hand the agent the report. Gate is fast, free and deterministic, so the fix-verify loop is tight. Save `--mode all` for when you want the AI review's judgement too.

## How the skill makes that work

One skill file, three sections, plus pointers for setup and CI requests. Deliberately one file rather than three: an agent that knows how to fix a finding also needs to know when the right answer is to change a rule instead.

### 1. Fix findings

Read `.gribble/runs/latest.json`, work through the findings, fix them, verify.

The skill tells the agent to:

- read the report and work in severity order — `critical`, then `error`, then `warn`, ignoring `info` unless asked;
- only act on findings with `status: "new"`, because `existing` ones are the accepted baseline and fixing them is a separate, deliberate piece of work;
- use `location.file` and `location.symbol` to find the code, rather than guessing from the route;
- read `suggestion` and follow `docsUrl` when it needs to understand a rule;
- **verify with `gribble audit --mode gate`**, which is fast, deterministic and costs no tokens, rather than declaring victory after editing;
- treat a finding it believes is wrong as a conversation, not a `gribble ignore` — suppressing a finding is a decision for a human;
- never hand-edit `.gribble/baseline/`, and only update the baseline when you ask for it.

That last point is the one that matters most. An agent with the power to silence its own critic is not a useful critic.

### 2. Write flows

The [flow](/docs/flows) format: Markdown with `name`, `requires_auth`, `env` and `tags` frontmatter, prose describing intent rather than selectors, and at least one stated outcome. The skill covers when to add a flow — usually in response to a `review/flow-coverage` finding — and how the `.replay.json` sidecar gets generated so gate can replay it deterministically.

### 3. Change rules and guidelines

Which file a change belongs in, which is the thing people most often get wrong:

| Change | File |
| --- | --- |
| Mechanically checkable standard | [`rules.yaml`](/docs/configuration/rules-yaml) |
| Judgement call, needs a model to read the page | [`guidelines.md`](/docs/guidelines) |
| Where the site is, which model, budgets, origins | [`gribble.yaml`](/docs/configuration/gribble-yaml) |
| One specific finding that is not a real problem | `ignore` in `rules.yaml`, with a comment, after a human agrees |

So "our buttons must be at least 44px" ends up as `a11y/touch-target` in `rules.yaml`, while "our error messages must say what to do next" ends up as prose in `guidelines.md` — and your agent knows the difference without being told each time.

## Installing

`gribble init` detects which coding agents your repository uses and offers to install:

> Teach your coding agent to feed the gribbles?

Detection is by directory:

| Found | Agent kind |
| --- | --- |
| `.claude/` | `claude` |
| `.pi/` | `pi` |
| `.cursor/` | `cursor` |
| `AGENTS.md` or `.agents/` | `agents` |

Install paths follow each ecosystem's convention:

| Agent kind | Path |
| --- | --- |
| `agents`, `pi` | `.agents/skills/gribble/SKILL.md` |
| `claude` | `.claude/skills/gribble/SKILL.md` |
| `cursor` | `.cursor/skills/gribble/SKILL.md` |

pi reads the Agent Skills standard location directly, which is why `pi` and `agents` share a path.

`gribble init --yes` installs to every agent it detects, without asking. That is what the [Agent setup guide](/docs/agent-setup) runs, so if your agent set Gribble up, the skill is already there.

Commit the installed skill. It is a project file, like a lint config: everyone on the team — and every agent session — should have it.

## Updating

The skill file ships with `@gribble/skills` and carries a version. After upgrading Gribble, refresh it. Your agent can do both in one go:

```prompt
Upgrade Gribble to the latest version, refresh the installed Gribble skill, and run a gate audit to check nothing changed.
```

By hand:

```bash
pnpm exec gribble init --update-skills
```

This only touches skill files. It does not re-run the init walkthrough, does not touch `gribble.yaml`, `rules.yaml` or `guidelines.md`, and does not ask about the target URL. Each installed skill is reported as `installed`, `updated` or `unchanged`, and the installed version is read from the file itself, so an old copy is detected reliably.

Worth adding to whatever you already run after a dependency bump.

## Offline documentation

The `docs/` directory ships inside the npm package. After `pnpm add -D gribble`, the full documentation is on disk at:

```
node_modules/gribble/docs/
```

The skill points agents there first. That means:

- an agent can read the rule reference and the config schema **without network access**, which matters in sandboxed environments and locked-down CI;
- the documentation an agent reads is the documentation for the **version you have installed**, not whatever is on the website today — no advice about a flag that does not exist in your version yet;
- there is no fetch latency in the loop.

The same content is at [gribble.dev/docs](https://gribble.dev/docs). Every page is also served as raw Markdown by appending `.md` to its URL, and `llms.txt` and `llms-full.txt` are published at the site root following the llmstxt.org convention, for agents that do have network access.

## Using it without the skill installer

The skill is a plain Markdown file. If your agent is not one of the four detected kinds, copy it wherever your agent reads project instructions, or point that agent at `node_modules/gribble/docs/` and let it read these pages directly. Nothing about the loop depends on the skill being installed in a specific place — the skill just saves you re-explaining it.

The programmatic interface is available too, if you are building tooling around this:

```ts
import { detectAgents, installSkill, skillSource, SKILL_VERSION } from "@gribble/skills";

const kinds = await detectAgents(process.cwd());
const results = await installSkill(process.cwd(), kinds);
// -> [{ kind: "claude", path: ".claude/skills/gribble/SKILL.md", status: "updated" }]
```
