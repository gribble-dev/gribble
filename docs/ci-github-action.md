---
title: CI and the GitHub Action
description: Run Gribble on every pull request, comment findings, upload SARIF, and keep the baseline fresh.
order: 50
---

The GitHub Action wraps `gribble audit --ci` and does the GitHub-shaped work around it: a check run with annotations, PR comments that update in place instead of piling up, SARIF for code scanning, JUnit for test reporters, the run directory as an artifact, and baseline maintenance after a merge.

```yaml
uses: gribble-dev/action@v1
```

## A complete workflow

Two jobs. Pull requests get audited and commented on; pushes to the default branch refresh the baseline.

```yaml
# .github/workflows/gribble.yml
name: Gribble

on:
  pull_request:
  push:
    branches: [main]

jobs:
  audit:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      checks: write
      security-events: write
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0          # baseline comparison needs history

      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile
      - run: pnpm exec gribble install     # Playwright browser

      - uses: gribble-dev/action@v1
        id: gribble
        with:
          mode: all
          fail-on: error
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: gribble.sarif

  baseline:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec gribble install

      - uses: gribble-dev/action@v1
        with:
          mode: gate
          update-baseline: true
          comment: false
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

A few choices in there worth explaining.

`fetch-depth: 0` gives the Action the git history it needs to resolve the base commit and to decide which files changed. `mode: gate` in the baseline job is deliberate — that job exists to record metrics and snapshots, and paying for an AI review that nobody will read is waste. `comment: false` for the same reason: there is no pull request to comment on.

`mode: all` in the audit job needs the AI review runtime in the repository's devDependencies — `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent`, which Gribble declares as [optional peer dependencies](/docs/getting-started#the-review-runtime-is-optional) that no package manager installs on its own. `pnpm install --frozen-lockfile` then picks them up like anything else. The baseline job's `mode: gate` needs neither, which is the point: a gate-only repository installs no model runtime at all.

## Inputs

| Input | Type | Default | Description |
| --- | --- | --- | --- |
| `mode` | `gate` \| `review` \| `all` | `all` | Which half of the audit to run. |
| `working-directory` | string | `.` | Directory to run in. Use for a repo where the app is not at the root. |
| `target` | string | — | Audit a specific app in a monorepo, e.g. `apps/web`. |
| `all` | boolean | `false` | Discover and audit every `.gribble/` in the repository. |
| `environment` | string | — | Environment name from `gribble.yaml`, passed as `--env`. |
| `update-baseline` | boolean | `false` | Write the baseline after the run and commit it back. Only meaningful on the default branch. |
| `comment` | boolean | `true` | Post and update PR comments. |
| `max-comments` | number | `5` | Maximum number of new per-finding review comments per run; the rest are listed in the summary comment. |
| `fail-on` | `critical` \| `error` \| `warn` \| `none` | `error` | Lowest severity of a **new** finding that fails the step. |
| `github-token` | string | `${{ github.token }}` | Token used for comments, checks and baseline commits. |
| `report-artifact` | boolean | `true` | Upload the run directory as a workflow artifact. |

`fail-on: none` is the right setting while you are rolling Gribble out: everything still gets reported, commented on and uploaded, but nobody's build breaks while the team gets used to it. Tighten to `error` once the baseline is honest.

## Outputs

| Output | Description |
| --- | --- |
| `gate` | `pass` or `fail`. |
| `new-findings` | Number of findings with status `new`. |
| `report-path` | Absolute path of the report JSON, normally `.gribble/runs/latest.json`. |
| `sarif-path` | Absolute path of `gribble.sarif`, ready for `github/codeql-action/upload-sarif`. |

```yaml
      - uses: gribble-dev/action@v1
        id: gribble
        with:
          fail-on: none

      - name: Warn in the job summary
        if: steps.gribble.outputs.gate == 'fail'
        run: echo "::warning::Gribble found ${{ steps.gribble.outputs.new-findings }} new findings"
```

## Permissions

Grant the least that covers what you enabled.

| Permission | Needed for |
| --- | --- |
| `contents: read` | Always. Checking out the repository. |
| `contents: write` | `update-baseline: true` with `baseline.update: commit`. |
| `pull-requests: write` | PR comments, and `baseline.update: pr`. |
| `checks: write` | The check run and its annotations. |
| `security-events: write` | Uploading SARIF to code scanning. |

Gribble uses `GITHUB_TOKEN` and does not require a GitHub App.

**Forked pull requests** get a read-only token, so comments and check annotations will not post. This is a GitHub restriction, not a Gribble one. The audit still runs and the artifact still uploads; if you need comments on fork PRs, use `pull_request_target` and understand the security trade-off you are making by doing so.

**Workflow approval.** Pull requests from first-time contributors, and workflow runs on branches pushed by a bot or an automation token, can sit in "workflow awaiting approval" until a maintainer approves the run from the pull request's Checks tab. Nothing posts until then; this is not the action being slow.

## How the Action runs the audit

1. Locates the `gribble` package in your repository (`working-directory` first, then the repository root). The version in your lockfile is the version that runs. When nothing is installed it falls back to npx and logs a warning: that is slower, unpinned, and runs whatever the latest release is — for `mode: review` or `all` the fallback also fetches the review runtime, at `latest` like everything else on that path. Add `gribble` as a devDependency instead.
2. Executes `gribble audit --ci --mode <mode>` with flags derived from the inputs.
3. Reads `.gribble/runs/latest.json`.
4. Creates or updates a **check run** with annotations. When a finding has `location.file`, the annotation lands on that file; the line is resolved by locating the recorded symbol in the file, since Gribble stores symbol names rather than line numbers on purpose.
5. Syncs **PR comments** (see below).
6. Writes `gribble.sarif` and `gribble-junit.xml`.
7. Uploads the run directory as an artifact.
8. Sets outputs and fails the step according to `fail-on`.

## PR comments

One pinned summary comment carrying `<!-- gribble:summary -->`, edited in place on every run. One comment per **new** finding carrying `<!-- gribble:fp:<hash> -->`, posted as an inline review comment when the file is known.

On re-run: a fingerprint that is still present updates its comment and keeps the thread; a fingerprint that has disappeared is edited to "patched ✅" and its thread is resolved; a new fingerprint gets a new comment, up to `max-comments`. Findings already in the baseline are counted in the summary and never commented on.

The summary looks roughly like this:

```md
<!-- gribble:summary -->
🪱 **The gribbles found 4 holes in your hull — 2 need patching before you sail.**

| | critical | error | warn | info |
| --- | --- | --- | --- | --- |
| New | 0 | 2 | 2 | 1 |

3 existing findings from the baseline · 1 fixed ✅

Showing 4 of 4 new findings. [Full report](…artifact link…)
```

The full mechanism is in [Findings](/docs/concepts/findings#comment-lifecycle).

## Artifacts

With `report-artifact: true` (the default), the whole run directory is uploaded: the report JSON, aria snapshots, screenshots, Playwright traces and the per-route metrics. That is the thing to download when a comment says something you do not believe.

Reports are self-contained — they carry their own version, repo, commit and model metadata — so an artifact downloaded six months from now still explains itself. See [Report format](/docs/report-format).

## SARIF and code scanning

`gribble.sarif` maps every finding to a SARIF result with its rule id, severity, message, file and region. Upload it and findings appear in the repository's Security tab alongside CodeQL results, with GitHub's own dedupe and dismissal workflow on top.

```yaml
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: gribble.sarif
```

`if: always()` matters — without it, a failed gate skips the upload and you lose exactly the results you wanted to see.

`gribble-junit.xml` is written alongside it for test reporters and dashboards that speak JUnit.

## Docker image

If installing a browser in CI is inconvenient, use the prebuilt image. It is based on the official Playwright image and ships Node 22, Gribble, the browsers and the AI review runtime, so every mode works out of the box.

```
ghcr.io/gribble-dev/gribble
```

```yaml
jobs:
  audit:
    runs-on: ubuntu-latest
    container:
      image: ghcr.io/gribble-dev/gribble:0
    permissions:
      contents: read
      pull-requests: write
      checks: write
    steps:
      - uses: actions/checkout@v7
        with: { fetch-depth: 0 }
      - run: pnpm install --frozen-lockfile
      - uses: gribble-dev/action@v1
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

No `gribble install` step is needed inside the container. The image is also handy outside GitHub Actions:

```bash
docker run --rm \
  -v "$PWD":/app -w /app \
  -e ANTHROPIC_API_KEY \
  ghcr.io/gribble-dev/gribble:0 \
  gribble audit --ci --mode gate
```

The image is tagged `latest`, with the exact version (`0.2.1`) and with the moving major (`0` while the CLI is 0.x, `1` from 1.0.0). Pin the major tag rather than `:latest` so a release cannot change your CI behaviour without a commit. Inside the container the action still runs the `gribble` from your lockfile; the image only supplies Node and the browser.

## Versions and the Node runtime

`uses: gribble-dev/action@v1` follows every release; `uses: gribble-dev/action@v0.2.1` pins one. The action is built from the [monorepo](https://github.com/gribble-dev/gribble/tree/main/packages/action) and published to [`gribble-dev/action`](https://github.com/gribble-dev/action) on every CLI release, so a version tag on the action equals the `gribble` version it was built from. `v1` is the moving tag for every 0.x and 1.x release.

The action declares `runs.using: node24`. GitHub runners have run JavaScript actions on Node 24 by default since June 16, 2026 and remove Node 20 on September 23, 2026, so this only matches what the runner does anyway. Your own job can still use `actions/setup-node` with Node 22 for the CLI; the two do not interfere.

## Secrets

Two categories, both repository secrets, both exposed as environment variables.

**Model provider key** — required for `review` and `all`:

```yaml
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Use an **API key**, not a subscription OAuth login. Subscription logins are personal credentials, billed and rate-limited against one human, and generally not licensed for shared automation. See [Auth](/docs/auth#subscription-oauth-must-not-go-into-ci).

**Target-site credentials** — whatever your [auth profiles](/docs/auth#part-1-target-site-auth) name:

```yaml
        env:
          GRIBBLE_USER_EMAIL: ${{ secrets.GRIBBLE_USER_EMAIL }}
          GRIBBLE_USER_PASSWORD: ${{ secrets.GRIBBLE_USER_PASSWORD }}
```

Use a dedicated test account on staging with no real data, never a production account.

Values of variables named in auth profiles are redacted from session logs, reports and comments before anything is written.

## Preview deployments

To audit a Vercel or Netlify preview instead of starting a dev server, define an environment in `gribble.yaml`:

```yaml
environments:
  preview:
    target:
      url: ${PREVIEW_URL}
      start: null
    allowed_origins: [localhost, "*.vercel.app"]
```

Then wait for the deployment and pass the URL:

```yaml
      - uses: gribble-dev/action@v1
        with:
          environment: preview
        env:
          PREVIEW_URL: ${{ steps.deployment.outputs.url }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Gribble skips the start command and audits the deployed URL directly, which is both faster and more honest than a dev build.

## Monorepos

One job, every app:

```yaml
      - uses: gribble-dev/action@v1
        with:
          all: true
```

The summary comment is sectioned per app, and fingerprints include the target name so two apps with the same bug stay distinct. Or audit one app:

```yaml
      - uses: gribble-dev/action@v1
        with:
          target: apps/web
```

See [Monorepos](/docs/monorepos).

## Baseline maintenance

A pull request never writes the baseline — otherwise a PR could bless its own regressions. Updates happen on the default branch, per `baseline.update` in `gribble.yaml`:

- **`commit`** (default) — the Action commits `.gribble/baseline/` back to the branch with `[skip ci]`. Needs `contents: write`.
- **`pr`** — the Action opens a `chore: update gribble baseline` pull request. For protected branches. Needs `pull-requests: write`.
- **`manual`** — CI never writes it; you run `gribble baseline update` locally and commit.

See [Baseline](/docs/concepts/baseline#update-strategies).

## Other CI systems

There is no bespoke integration for GitLab, CircleCI or Jenkins, and none is needed — the CLI is the whole product and the Action is a convenience around it. GitLab has its own page, [GitLab CI](/docs/ci-gitlab), because its merge request widget reads two of the files the CLI writes.

```bash
pnpm install --frozen-lockfile
pnpm exec gribble install
pnpm exec gribble audit --ci --mode gate
```

`--ci` prints the report JSON to stdout and progress to stderr, so `gribble audit --ci > report.json` gives you a clean file. Exit codes are `0` pass, `1` gate fail, `2` config or auth error, which is enough to drive any pipeline. SARIF, JUnit and GitLab Code Quality files are written to the run directory for whatever consumes them. See the [CLI reference](/docs/cli).
