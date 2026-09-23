---
title: Guidelines
description: House rules a model has to judge — written in prose, appended to Gribble's system prompt.
order: 41
---

`.gribble/guidelines.md` is where you write the standards that cannot be measured. It is plain Markdown, it is committed, and review mode reads it as context when it judges your UI.

`gribble init` creates it with a short template and a few prompts. Most teams end up with somewhere between 30 and 150 lines.

You rarely need to open it yourself. Tell your coding agent the house rule, and let it decide whether the rule is a judgement call for this file or a mechanical check for `rules.yaml`:

```prompt
Add a Gribble house rule: every empty state explains what will appear there and offers the action that creates the first item.
```

```prompt
No page should ship with "Coming soon" text on it. Make Gribble enforce that, in rules.yaml if a rule can check it or in guidelines.md if not.
```

## What belongs here, and what does not

The dividing line is simple: **can a program decide this without arguing?**

| Statement | Where it goes | Why |
| --- | --- | --- |
| Buttons must be at least 44px tall | `rules.yaml` (`a11y/touch-target`) | A number compared to a number |
| Colours must come from design tokens | `rules.yaml` (`ui/colors-from-tokens`) | Computed style compared to a token list |
| No `lorem ipsum` in shipped pages | `rules.yaml` (`ui/placeholder-text`) | Pattern match |
| Every page has exactly one `h1` | `rules.yaml` (`seo/single-h1`) | Counting |
| Error messages must say what to do next | `guidelines.md` | Requires reading the message |
| Tone is restrained and professional, never jokey | `guidelines.md` | Requires taste |
| Destructive actions need a confirmation step | `guidelines.md` | Requires understanding what is destructive |
| Empty states explain how to create the first item | `guidelines.md` | Requires understanding the screen |
| Which URL to audit, which model, budgets | `gribble.yaml` | Runtime settings, not standards |

Two useful heuristics:

- **If you could write a test for it, it is a rule.** Put it in `rules.yaml` where it is deterministic, free and able to block a merge. Findings from real rules are far more trustworthy than a model's opinion about the same thing.
- **If reasonable colleagues could disagree, it is a guideline.** That is not a weakness; it is exactly the class of problem a model is good at spotting and a linter is not.

When something starts as a guideline and you later realise it is mechanical, move it. A guideline promoted to a rule is a small win every single run.

## How it is injected

Gribble builds a fixed system prompt describing the audit task, the tools, the finding format and the guardrails. **Your guidelines are appended to it as an additional section.** You are adding to the instructions, not replacing them.

There is deliberately no way to override the system prompt in this version. The prompt is what makes findings structured, fingerprintable and comparable across runs; letting it be replaced would mean every project's reports mean something different, and the baseline machinery would stop working.

Practical consequences:

- Guidelines are **context and criteria**, not commands. "Never report accessibility problems" will not disable `a11y/axe` — that is a rule, and rules run in code before the model is involved.
- Guidelines only affect **review** mode. `--mode gate` never loads a model, so the file is not read.
- Violations surface as `review/guidelines` findings, capped at that rule's severity (`warn` by default).
- The file is sent with every review audit, so its length is a real token cost. Prefer sharp and short.

## Writing them well

**Be concrete, and say why.** A model, like a new hire, applies a rule better when it knows the reason.

Vague:

> Copy should be good.

Useful:

> **Copy**
> - Sentence case for headings and buttons. Not Title Case, not ALL CAPS.
> - Say what the button does: "Create project", not "Submit" or "OK".
> - Use "sign in" and "sign out" throughout. Never "log in", "login" or "logout".
> - Numbers over vagueness: "3 members" beats "several members".

**Give examples, especially bad ones.** A contrasting pair is worth a paragraph of description.

```md
### Error messages

Every error says what happened and what to do next.

- Bad: "An error occurred."
- Bad: "Error 500: Internal Server Error"
- Good: "We couldn't save your changes because the project was deleted.
  Refresh to see the current list."
```

**Say what you do not want.** Negative rules are often the more useful half, because they name the thing the model would otherwise let pass.

> Never use a spinner as the only feedback for an action that takes under 300ms.
> Never put a destructive action as the rightmost, primary-styled button in a dialog.

**Scope by area when your product has distinct surfaces.**

```md
## Marketing pages
Warm, direct, second person. Exclamation marks are fine.

## Application UI
Neutral and terse. No exclamation marks. No jokes in error states.

## Admin
Density over friendliness. Assume the reader uses this eight hours a day.
```

**Prune.** Guidelines that never produce a finding are either already universally followed or too vague to apply. Both cases argue for deleting the line.

## A worked example

```md
# Guidelines

House rules for reviewing this product. Rules that can be checked mechanically
live in rules.yaml; this file is for judgement calls.

## Voice and tone

- Neutral, direct, professional. No jokes in the product UI.
- Second person for instructions ("Choose a plan"), never first person plural
  ("Let's choose a plan").
- Sentence case for all headings, buttons and labels.

## Terminology

Use these words and no synonyms. Inconsistency here is a finding.

| Use | Not |
| --- | --- |
| project | workspace, space |
| member | user, seat, teammate |
| sign in / sign out | login, log in, logout |
| plan | tier, package |

## Buttons and actions

- The label names the action: "Create project", not "Submit" or "OK".
- Exactly one primary button per view.
- Destructive actions are secondary-styled, sit on the left of a dialog's
  button row, and require a confirmation step naming the thing being deleted.

## States

Every list, table and data view has all four states designed:

- **Loading** — skeleton, not a bare spinner, when the shape is predictable.
- **Empty** — explains what goes here and offers the action to create the
  first one. "No projects" alone is a finding.
- **Error** — says what failed and what to do next. Offers a retry when a
  retry could work.
- **Partial** — when some data failed to load, say which part.

## Forms

- Labels are always visible. Placeholder text is never the only label.
- Validation errors appear next to the field, not only in a summary at the top.
- Say what a valid value looks like before the user gets it wrong.
- Never clear a user's input on a validation error.

## Navigation

- Every page is reachable from the primary navigation or from a page that is.
- Every page below the top level has a visible way back that is not the
  browser button.
- The current location is indicated in the navigation.

## What not to flag

- Marketing pages (`/`, `/pricing`, `/about`) intentionally use a warmer tone
  than the app. Do not report them for exclamation marks.
- The legacy admin area under `/admin/legacy/**` is being replaced in Q3.
  Do not report styling or layout there.
```

That last section earns its place. Telling the reviewer where not to look is as valuable as telling it what to look for, and it is the fastest way to kill a recurring false positive without turning a rule off globally.

## Monorepo concatenation

In a [monorepo](/docs/monorepos), `guidelines.md` files **concatenate** from the repository root down to the app, root first.

```
.gribble/guidelines.md              company-wide voice, terminology, a11y stance
apps/web/.gribble/guidelines.md     consumer app specifics
apps/admin/.gribble/guidelines.md   admin specifics
```

Auditing `apps/admin` gives the model the root guidelines followed by the admin ones, in that order, in one document. Nothing is replaced, because concatenating prose is the only merge that makes sense — there is no key to override.

This differs from `rules.yaml`, which **merges** with child settings overriding parent ones. Rules have keys; prose does not.

Because the later text wins arguments in practice, use the app-level file for narrowing, exceptions and additions:

```md
# Admin guidelines

Extends the root guidelines. Where they conflict, this file wins.

- The root rule about warm, welcoming copy does not apply here. Admin copy is
  terse and assumes an expert user.
- Density is a feature. Do not report compact tables as cramped.
- Every destructive admin action must name the affected record count in the
  confirmation, e.g. "Delete 1,204 records?".
```

Keep the root file to things that are genuinely true everywhere — voice, terminology, accessibility commitments, security expectations. Everything specific belongs next to the app it describes.

## Keeping them alive

- **Review them when a finding is wrong.** A false positive from `review/guidelines` usually means a guideline is ambiguous. Sharpen the sentence rather than ignoring the finding.
- **Let your coding agent maintain them.** The [Gribble skill](/docs/skills) teaches Claude Code, pi and Cursor what belongs in this file versus `rules.yaml`, so "add a guideline about empty states" lands in the right place.
- **Treat them as documentation for people too.** A good `guidelines.md` is the design review checklist your team already had in its head. Writing it down for the model is how it finally gets written down at all.

```prompt
Gribble keeps flagging our marketing pages for exclamation marks, which are fine there. Find the guideline behind those findings and rewrite it so it only applies to the application UI.
```
