---
title: Skills for coding agents
description: Teach Claude Code, pi or Cursor to read Gribble's report, fix what it found, and keep your rules and flows current.
order: 53
---

Gribble finds problems. Something has to fix them. In most repositories that something is already a coding agent, and the fastest closed loop looks like this:

**Gribble audits → your agent reads the report → your agent fixes the findings → `gribble audit --mode gate` verifies → your agent updates the flows and rules it learned about.**

The `@gribble/skills` package ships a skill file that teaches your agent every step of that loop, so "fix the Gribble findings" becomes a request that works without you explaining the tooling each time.

## What the skill contains

One skill file, three sections. Deliberately one file rather than three: an agent that knows how to fix a finding also needs to know when the right answer is to change a rule instead.

### 1. Fix findings

Read `.gribble/runs/latest.json`, work through the findings, fix them, verify.

The skill tells the agent to:

- read the report and work in severity order — `critical`, then `error`, then `warn`, ignoring `info` unless asked;
- only act on findings with `status: "new"`, because `existing` ones are the accepted baseline and fixing them is a separate, deliberate piece of work;
- use `location.file` and `location.symbol` to find the code, rather than guessing from the route;
- read `suggestion` and follow `docsUrl` when it needs to understand a rule;
- **verify with `gribble audit --mode gate`**, which is fast, deterministic and costs no tokens, rather than declaring victory after editing;
- treat a finding it believes is wrong as a conversation, not a `gribble ignore` — suppressing a finding is a decision for a human.

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

`gribble init --yes` installs to every agent it detects, without asking.

Commit the installed skill. It is a project file, like a lint config: everyone on the team — and every agent session — should have it.

## Updating

The skill file ships with `@gribble/skills` and carries a version. After upgrading Gribble, refresh it:

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

## Using it

Once installed, ordinary requests work:

> Fix the Gribble findings on the pricing page.

> Gribble says the checkout flow is broken. Look at the latest report and fix it.

> Add a flow for the password reset journey.

> Gribble keeps flagging our admin tables for contrast. Look at whether that rule should be scoped differently.

The agent knows where the report is, what the fields mean, how to verify, and what not to touch.

A pattern worth adopting: run `gribble audit --mode gate` yourself, then hand the agent the report. Gate is fast, free and deterministic, so the fix-verify loop is tight. Save `--mode all` for when you want the AI review's judgement too.

## Using it without the skill installer

The skill is a plain Markdown file. If your agent is not one of the four detected kinds, copy it wherever your agent reads project instructions, or point that agent at `node_modules/gribble/docs/` and let it read these pages directly. Nothing about the loop depends on the skill being installed in a specific place — the skill just saves you re-explaining it.

The programmatic interface is available too, if you are building tooling around this:

```ts
import { detectAgents, installSkill, skillSource, SKILL_VERSION } from "@gribble/skills";

const kinds = await detectAgents(process.cwd());
const results = await installSkill(process.cwd(), kinds);
// -> [{ kind: "claude", path: ".claude/skills/gribble/SKILL.md", status: "updated" }]
```
