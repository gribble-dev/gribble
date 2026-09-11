---
title: gribble.yaml
description: Project settings — target URL, model, budgets, origins, environments, auth profiles, baseline and output.
order: 30
---

`.gribble/gribble.yaml` holds the settings somebody configures once and rarely touches: where the site is, how to start it, which model to use, and what the agent is allowed to do. It is committed.

Rules live in a separate file. [`rules.yaml`](/docs/configuration/rules-yaml) is the part the team argues about and edits weekly; `gribble.yaml` is the part the person who installed Gribble set up on day one. Different cadence, different people, different file.

**Secrets never go in this file.** Only environment variable names.

## What `gribble init` writes

Init generates the minimum. Every other field exists and is validated, but is not written until you need it.

```yaml
# yaml-language-server: $schema=https://gribble.dev/schema/gribble.json
target:
  url: http://localhost:3000        # or ${PREVIEW_URL}
  start: pnpm dev                    # optional; Gribble waits until url responds
  routes: auto                       # auto (from framework) | crawl | [list of paths]
model: <provider/model>              # pi syntax, supports provider/id:thinking; chosen during init
review:
  max_comments: 5
  min_confidence: 0.7                # AI findings below this are dropped
  vision: false                      # enable the screenshot tool for the model
budget:
  max_steps: 200
  max_tokens: 2000000
allowed_origins: [localhost, "*.vercel.app"]
# Later, when needed: environments, auth (see /docs/auth), baseline, viewports, output
```

## Editor completion

The first line is not decoration. With the YAML Language Server (built into VS Code's YAML extension, and available in Neovim, Zed and JetBrains IDEs) it gives you completion, inline documentation and validation as you type.

```yaml
# yaml-language-server: $schema=https://gribble.dev/schema/gribble.json
```

The schema is generated from the same TypeBox definitions Gribble validates with, so it can never drift from what the parser accepts. `rules.yaml` has its own at `https://gribble.dev/schema/rules.json`.

## Full reference

### `target`

Where the site under audit lives.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `target.url` | string | — | **Required.** The base URL to audit. `${VAR}` interpolation allowed. |
| `target.start` | string | — | Command to start the site. Run before the audit; Gribble waits for `url` to respond, then shuts it down afterwards. Omit when the URL is already up. |
| `target.routes` | `auto` \| `crawl` \| string[] | `auto` | `auto` reads your framework's routes (Next.js app directory, React Router, Nuxt pages). `crawl` follows links from the base URL. An explicit list audits exactly those paths. |
| `target.readyTimeoutMs` | number | `120000` | How long to wait for `url` to respond after running `start`. |

```yaml
target:
  url: ${PREVIEW_URL}
  routes:
    - /
    - /pricing
    - /blog/[slug]
    - /docs/getting-started
```

An explicit list is the fastest and most predictable option, and the one to reach for when `auto` picks up hundreds of generated routes. Bracketed segments are matched against real URLs, and one representative page per pattern is audited.

### `model`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `model` | string | — | `provider/id` or `provider/id:thinking`, pi syntax. Chosen during init. |

Committing the model is deliberate: your whole team and your CI then run the same audit, and `review/*` findings stay comparable across runs. When the configured provider has no credentials on the current machine, Gribble fails with exit code 2 and tells you to run `gribble login <provider>`.

Leave it out and Gribble falls back to `~/.gribble/settings.json`, then to the first model with valid auth, with a warning. See [Auth](/docs/auth#part-2-model-provider-auth).

### `review`

Controls the AI half of an audit. Has no effect in `--mode gate`.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `review.max_comments` | number | `5` | Maximum PR comments for **new** findings. Everything else stays in the report. |
| `review.min_confidence` | number | `0.7` | AI findings below this confidence are dropped entirely. |
| `review.vision` | boolean | `false` | Hands the `screenshot` tool to the model. Off by default — the model reads structured page snapshots, which are more accurate than pixels for colours, sizes and names. |
| `review.explore` | boolean | `true` | Lets the agent visit routes no flow describes, looking for dead ends and missing states. Set `false` to restrict review to your flows. |

### `budget`

Hard caps per audit. When one is hit the run ends cleanly and reports what it has.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `budget.max_steps` | number | `200` | Maximum agent steps (tool calls plus model turns). |
| `budget.max_tokens` | number | `2000000` | Maximum tokens across the whole audit. |
| `budget.max_cost_usd` | number | — | Optional dollar ceiling, using pi's model pricing table. |

Every audit prints its actual usage at the end, and the numbers are in `report.budget`. Start with the defaults, look at what a real run costs on your site, then tighten.

### `allowed_origins`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `allowed_origins` | string[] | `[]` | Hostnames or globs the agent may navigate to, in addition to the target host, which is always allowed. |

```yaml
allowed_origins:
  - localhost
  - "*.vercel.app"
  - "*.mycompany-staging.com"
```

This is a guardrail, not a convenience. The agent cannot navigate outside it, which is what keeps a curious model from wandering onto your production site, a payment provider, or somebody else's server entirely. External link checking is unaffected — `links/broken-external` issues HTTP requests, it does not drive the browser there.

### `environments`

Named blocks deep-merged over the top level when you pass `--env <name>`.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `environments.<name>` | object | — | A partial `gribble.yaml` merged over the root config. Any top-level field may be overridden. |

```yaml
target:
  url: http://localhost:3000
  start: pnpm dev
allowed_origins: [localhost]

environments:
  preview:
    target:
      url: ${VERCEL_PREVIEW_URL}
      start: null              # nothing to start; the URL is already live
    allowed_origins: [localhost, "*.vercel.app"]
    review:
      max_comments: 3
  staging:
    target:
      url: https://staging.example.com
      start: null
    auth:
      profiles:
        user:
          type: cookie
          name: session
          env: { value: GRIBBLE_STAGING_COOKIE }
```

```bash
gribble audit --env preview
```

The merge is deep: `environments.preview.target.url` replaces `target.url` and leaves `target.routes` alone. The selected environment name ends up in `report.target.environment`, so reports from different environments are distinguishable.

### `auth`

Auth profiles for the **site under test** — not for your model provider. Full treatment in [Auth](/docs/auth).

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `auth.profiles.<name>.type` | `flow` \| `cookie` \| `header` \| `command` | — | How to obtain the logged-in state. |
| `auth.profiles.<name>.flow` | string | — | `type: flow`. Path to a login flow Markdown file. |
| `auth.profiles.<name>.command` | string | — | `type: command`. Command printing a Playwright storage state JSON to stdout. |
| `auth.profiles.<name>.name` | string | — | `type: cookie` / `header`. The cookie or header name. |
| `auth.profiles.<name>.env` | object | — | Map of logical field name to **environment variable name**. Never a value. |

```yaml
auth:
  profiles:
    user:
      type: flow
      flow: flows/auth/login.md
      env: { email: GRIBBLE_USER_EMAIL, password: GRIBBLE_USER_PASSWORD }
    admin:
      type: command
      command: pnpm exec ./scripts/admin-session.ts
    readonly:
      type: cookie
      name: session
      env: { value: GRIBBLE_COOKIE }
    api:
      type: header
      name: Authorization
      env: { value: GRIBBLE_TOKEN }
```

A flow claims a profile with `requires_auth: user` in its frontmatter.

### `baseline`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `baseline.screenshots` | `commit` \| `lfs` \| `off` | `commit` | How baseline screenshots are stored. `lfs` for large sites; `off` disables `visual/regression`. |
| `baseline.update` | `commit` \| `pr` \| `manual` | `commit` | How the baseline is refreshed after a merge. `commit` pushes to the default branch with `[skip ci]`; `pr` opens a chore PR; `manual` leaves it to you. |

See [Baseline](/docs/concepts/baseline).

### `viewports`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `viewports.<name>.width` | number | see below | Viewport width in CSS pixels. |
| `viewports.<name>.height` | number | see below | Viewport height in CSS pixels. |

```yaml
viewports:
  mobile:  { width: 390, height: 844 }
  desktop: { width: 1366, height: 768 }
```

Those two are the defaults. Add your own names freely — rules that take a `viewports` option, like `ui/horizontal-overflow` and `visual/regression`, refer to these names. Every extra viewport multiplies screenshot and Lighthouse work, so add them with intent.

### `output`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `output.dir` | string | `.gribble/runs` | Where run directories are written. |
| `output.keep` | number | `10` | How many run directories to keep before pruning the oldest. |

`.gribble/runs/latest.json` is always written, whatever `dir` says, because that is the path the [skill](/docs/skills) and your coding agent look for.

### `reusePiAuth`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `reusePiAuth` | boolean | `false` | Use `~/.pi/agent/` for model credentials instead of `~/.gribble/`. |

For people who already use pi and do not want a second login. It only affects where auth and model files are read from; Gribble still uses its own system prompt, tools and guardrails. `GRIBBLE_HOME` overrides the directory either way.

## `${VAR}` interpolation

Any string value may reference an environment variable:

```yaml
target:
  url: ${PREVIEW_URL}
```

Rules:

- Interpolation happens at load time, in string values only.
- A referenced variable that is not set is a **hard error**, and the message names the variable:

  ```
  Config error at target.url: environment variable PREVIEW_URL is not set.
  ```

  Failing loudly beats auditing `http://undefined/` and reporting that every route is broken.
- This is for values that vary per machine or per run — preview URLs, ports, hostnames. **It is not for secrets.** Secrets go in `auth.profiles.*.env`, which takes variable *names* and reads them at the moment they are used, so they never pass through the config object or a session log.

## Validation

Config is validated on every command. Errors carry a path and a message:

```
Config error at review.min_confidence: expected number between 0 and 1, got "high".
Config error at target: required property "url" is missing.
```

Any config or auth failure exits with code `2`, distinct from `1`, which means the gate found something. CI can tell "your site has a problem" apart from "your setup has a problem".

## A fuller example

```yaml
# yaml-language-server: $schema=https://gribble.dev/schema/gribble.json
target:
  url: http://localhost:3000
  start: pnpm dev
  routes: auto
  readyTimeoutMs: 180000

model: <provider/model>

review:
  max_comments: 5
  min_confidence: 0.75
  vision: false
  explore: true

budget:
  max_steps: 200
  max_tokens: 2000000
  max_cost_usd: 2.00

allowed_origins: [localhost, "*.vercel.app"]

auth:
  profiles:
    user:
      type: flow
      flow: flows/auth/login.md
      env: { email: GRIBBLE_USER_EMAIL, password: GRIBBLE_USER_PASSWORD }

baseline:
  screenshots: commit
  update: commit

viewports:
  mobile:  { width: 390, height: 844 }
  desktop: { width: 1366, height: 768 }

output:
  dir: .gribble/runs
  keep: 10

reusePiAuth: false

environments:
  preview:
    target:
      url: ${VERCEL_PREVIEW_URL}
      start: null
    review:
      max_comments: 3
```
