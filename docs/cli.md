---
title: CLI reference
description: Every command, every flag, exit codes, and the --ci output contract.
order: 60
---

```bash
gribble <command> [options]
```

Gribble installs as a devDependency, so run it through your package manager:

```bash
pnpm exec gribble audit
npx gribble audit
yarn gribble audit
```

Examples below omit the runner for readability.

## Commands at a glance

| Command | Purpose |
| --- | --- |
| [`init`](#gribble-init) | Create `.gribble/`, choose a model, install agent skills |
| [`audit`](#gribble-audit) | Run an audit |
| [`install`](#gribble-install) | Download the Playwright browser |
| [`login`](#gribble-login) | Authenticate with a model provider |
| [`logout`](#gribble-logout) | Remove stored credentials |
| [`models`](#gribble-models) | List available models, recommended first |
| [`explain`](#gribble-explain) | Describe a rule |
| [`ignore`](#gribble-ignore) | Suppress a finding by fingerprint |
| [`baseline update`](#gribble-baseline-update) | Refresh the baseline |
| [`version`](#gribble-version) | Print the version |

---

## `gribble init`

Sets up `.gribble/` in the current directory.

```bash
gribble init
gribble init --yes
gribble init --url http://localhost:5173 --start "pnpm dev"
gribble init --update-skills
```

| Flag | Description |
| --- | --- |
| `--yes` | Accept every default, including installing skills into all detected agents. Non-interactive. |
| `--update-skills` | Only refresh installed agent skill files. Skips the rest of the walkthrough entirely. |
| `--url <url>` | Target URL. Skips that question. |
| `--start <cmd>` | Start command. Skips that question. |
| `--model <provider/id>` | Model. Skips model selection. |

Creates:

```
.gribble/
  gribble.yaml
  rules.yaml
  guidelines.md
  flows/README.md
  flows/smoke.md
  baseline/.gitkeep
  .gitignore          (runs/ sessions/ cache/)
```

It never modifies your repository root `.gitignore`, and warns if that file already ignores the whole `.gribble/` directory — which would also discard the rules, flows and baseline you are meant to commit.

If your credentials cannot reach any model, init offers to run `login` first. See [Getting started](/docs/getting-started#gribble-init).

---

## `gribble audit`

The main command.

```bash
gribble audit
gribble audit --mode gate
gribble audit --ci --mode all
gribble audit --target apps/web --env preview
gribble audit --routes /,/pricing,/blog/[slug]
gribble audit --all --changed
```

| Flag | Default | Description |
| --- | --- | --- |
| `--mode gate\|review\|all` | `all` | Which half to run. `gate` is deterministic and needs no model; `review` is the AI agent. See [Gate and review](/docs/concepts/gate-and-review). |
| `--ci` | off | Machine-readable mode: report JSON on stdout, progress on stderr. |
| `--target <dir>` | — | Audit a specific app in a [monorepo](/docs/monorepos), e.g. `apps/web`. |
| `--all` | off | Audit every `.gribble/` in the repository. |
| `--env <name>` | — | Apply an `environments.<name>` block from `gribble.yaml`. |
| `--update-baseline` | off | Write the [baseline](/docs/concepts/baseline) from this run. Does not commit. |
| `--json` | off | Print the report JSON to stdout without the `--ci` progress behaviour. |
| `--routes a,b` | — | Audit only these routes. Overrides `target.routes`. |
| `--changed` | off | Audit only routes affected by the git diff, using the workspace dependency graph in a monorepo. |

`.gribble/runs/latest.json` is written on every run regardless of flags. That path is what the [coding-agent skill](/docs/skills) and the [GitHub Action](/docs/ci-github-action) read.

### Terminal output

```
🪱 3 gribbles are nibbling on localhost:3000…
   ✓ routes        12 discovered
   ✓ links         248 checked
   ✓ a11y          12 routes
   ✓ perf          12 routes
   … reviewing /pricing

The gribbles found 4 holes in your hull — 2 need patching before you sail.

  error    links/broken          /pricing     → /docs/plans returns 404
  error    a11y/form-labels      /signup      Input #email has no associated label
  warn     seo/meta-description  /blog/[slug] 22 characters, minimum is 50
  warn     review/copy           /pricing     "Contact sales" and "Talk to sales" on the same page

  3 existing · 1 fixed ✅
  Report: .gribble/runs/2025-03-02T14-21-08Z/report.json
  204 steps · 318k tokens · $0.42
```

Or, on a clean run:

```
The gribbles went hungry. Ship it.
```

### `--ci` output contract

This is the contract CI systems can rely on. It will not change within a major version.

- **stdout** receives exactly one thing: the complete [report JSON](/docs/report-format), printed once when the audit finishes. Nothing else is ever written to stdout — no progress, no warnings, no banner. `gribble audit --ci > report.json` yields a valid JSON file.
- **stderr** receives all progress and diagnostics, as plain lines without ANSI colour or cursor control, safe for a log viewer.
- **Exit code** follows the table below.
- `.gribble/runs/latest.json` is written as usual, and `gribble.sarif` plus `gribble-junit.xml` are written to the run directory.
- Sessions are kept in memory rather than written to `.gribble/sessions/`.
- No interactive prompt is ever shown. Anything that would need one is an error with exit code `2`.

```bash
gribble audit --ci --mode gate > report.json
jq '.summary.gate' report.json     # "pass" | "fail"
jq '.summary.newCount' report.json
```

With `--all`, stdout carries one report per target.

---

## `gribble install`

```bash
gribble install
```

Downloads the Playwright Chromium build Gribble drives. Run once after installing, and after a Gribble upgrade that changes the browser version. Unnecessary inside the [Docker image](/docs/ci-github-action#docker-image) or on a CI image that already provisions Playwright browsers.

---

## `gribble login`

```bash
gribble login
gribble login <provider>
gribble login <provider> --api-key "$MY_KEY"
```

| Flag | Description |
| --- | --- |
| `--api-key <key>` | Store an API key instead of running an interactive OAuth flow. |

With no provider, you pick one from a list. Credentials go to `~/.gribble/auth.json`, or to `~/.pi/agent/` when `reusePiAuth: true`. See [Auth](/docs/auth#part-2-model-provider-auth).

Passing a key on the command line puts it in your shell history. Prefer `--api-key "$MY_KEY"` with the value in an environment variable, or set the provider's standard environment variable and skip `login` altogether.

---

## `gribble logout`

```bash
gribble logout
gribble logout <provider>
```

Removes stored credentials for one provider, or for all of them when no provider is named. Environment-variable credentials are unaffected — nothing on disk can unset those.

---

## `gribble models`

```bash
gribble models
```

Lists every model your current credentials can reach, **recommended first**. The recommended set prefers reliable tool calling, no vision requirement, and a price that survives being run on every pull request.

Copy an id into `model` in `gribble.yaml`. Gribble hardcodes no model name; the recommendation table is refreshed each release.

---

## `gribble explain`

```bash
gribble explain a11y/touch-target
gribble explain links/broken
```

Prints a rule's description, option schema with defaults, severity in each preset, a bad and a good example, and the fix hint — the same registry metadata that generates the [rules reference](/docs/configuration/rules-reference) and the `docsUrl` on every finding.

---

## `gribble ignore`

```bash
gribble ignore 9f2c1d4a7b3e0c58
```

Appends a fingerprint to `ignore` in `rules.yaml`. Add a comment explaining why, on the same line, before you commit it:

```yaml
ignore:
  - 9f2c1d4a7b3e0c58   # external link behind a paywall, verified manually
```

Fingerprints come from the report, the PR comment marker, or the terminal output with `--json`. This suppresses exactly one problem on exactly one route; it is not a way to turn a rule off. See [Findings](/docs/concepts/findings#suppression).

---

## `gribble baseline update`

```bash
gribble baseline update
```

Runs an audit and writes `.gribble/baseline/` from it. Equivalent to `gribble audit --update-baseline`. It does not commit — staging and committing is always your decision.

Reach for it when you deliberately accepted a regression, rewrote a page, changed viewports or rule severities, or are onboarding a new app. To suppress a single finding, use `ignore` instead. See [Baseline](/docs/concepts/baseline#updating-by-hand).

---

## `gribble version`

```bash
gribble version
```

Prints the Gribble version. Also available as `--version`.

---

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Everything passed. No new blocking findings. |
| `1` | The gate failed — at least one new `error` or `critical` finding from a deterministic rule or `flows/replay`. |
| `2` | Config or auth error. Invalid YAML, a missing environment variable, no credentials for the configured provider, a browser that will not start. |

The distinction between `1` and `2` is the useful part: `1` means your site has a problem, `2` means your setup does. A CI job that treats them identically will send people hunting for a bug that does not exist.

```bash
gribble audit --ci --mode gate
case $? in
  0) echo "clean" ;;
  1) echo "gate failed" ;;
  2) echo "gribble is misconfigured" ;;
esac
```

---

## Environment variables

| Variable | Effect |
| --- | --- |
| `GRIBBLE_HOME` | Overrides `~/.gribble` for settings, auth and the model catalogue. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, … | Provider credentials, read when `auth.json` has none. |
| Anything named in `auth.profiles.*.env` | Target-site credentials. Values are redacted from logs and reports. |
| Anything referenced as `${VAR}` in `gribble.yaml` | Interpolated at load time. A missing one is a hard error naming the variable. |

---

## Recipes

**Fastest possible pre-push check.**

```bash
gribble audit --mode gate --changed
```

Deterministic checks on only the routes your diff can affect. No model, no tokens.

**Verify an agent's fix.**

```bash
gribble audit --mode gate --routes /pricing
```

**Full pre-release sweep.**

```bash
gribble audit --mode all
```

**Audit a preview deployment.**

```bash
PREVIEW_URL=https://my-app-abc123.vercel.app gribble audit --env preview
```

**Extract findings for another tool.**

```bash
gribble audit --ci --mode gate > report.json
jq -r '.findings[] | select(.status=="new") | "\(.severity)\t\(.rule)\t\(.route)"' report.json
```

**Every app in a monorepo, incrementally.**

```bash
gribble audit --all --changed
```

**Re-baseline after an intentional redesign.**

```bash
gribble baseline update
git add .gribble/baseline
git commit -m "chore: update gribble baseline after nav redesign"
```
