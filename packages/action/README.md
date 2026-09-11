# Gribble GitHub Action

Tiny bugs that find your bugs before you ship. This action runs `gribble audit --ci` in your repository and turns the report into a check run with annotations, pull request comments, a SARIF/JUnit pair and a downloadable report artifact.

The action lives in this monorepo as `@gribble/action` and is published as [`gribble-dev/action`](https://github.com/gribble-dev/action).

## Usage

```yaml
name: Gribble
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  pull-requests: write
  checks: write

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - uses: gribble-dev/action@v1
        with:
          mode: all
          update-baseline: ${{ github.event_name == 'push' }}
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

The action expects `gribble` to be installed in the repository (`node_modules/.bin/gribble` in `working-directory`, then in the repository root). When it is missing it falls back to `npx --yes gribble`, which is slower and not pinned; add `gribble` as a devDependency instead.

Model credentials are read by the CLI from the environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ... as configured in `gribble.yaml`); pass them as `env`, never as inputs.

### What one run does

1. `gribble audit --ci --mode <mode> [--target <dir>] [--all] [--env <name>] [--update-baseline]` in `working-directory`. Progress streams to the job log; the report is read from `.gribble/runs/latest.json` (one per target with `all: true`).
2. Writes `gribble.sarif` and `gribble-junit.xml` next to the report and sets the outputs.
3. Uploads the run directory (report, screenshots, aria snapshots, traces) and the SARIF/JUnit files as the `gribble-report` artifact.
4. Creates the **Gribble** check run with one annotation per new finding that names a source file (line found by searching for the finding's symbol, else line 1).
5. On pull requests, maintains the comments (see below).
6. On pushes to the default branch with `update-baseline: true`, writes `.gribble/baseline/` back.
7. Fails the step according to `fail-on`.

### Pull request comments

- One summary comment marked `<!-- gribble:summary -->`, updated in place on every run.
- One review comment per new finding that maps to a file in the diff, marked `<!-- gribble:fp:<fingerprint> -->`. Re-runs update the comment and keep the thread; a fingerprint that disappears gets `patched ✅` prepended and its thread resolved.
- New findings that do not map into the diff (or exceed `max-comments`) are listed in the summary comment.
- Findings already recorded in `.gribble/baseline/findings.json` are counted, never commented. `info` findings stay in the report.
- `max-comments` applies to new findings only, ordered by severity, then confidence, deterministic rules first.
- Bootstrap runs (no baseline committed yet) post no comments.

Without `pull-requests: write` the action logs a warning and continues; without `checks: write` annotations degrade to workflow log annotations.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `mode` | `all` | `gate`, `review` or `all`. |
| `working-directory` | `.` | Directory containing the audited app's `.gribble/`. |
| `target` | | Monorepo target directory (`gribble audit --target`). |
| `all` | `false` | Audit every `.gribble/` under `working-directory`. |
| `environment` | | Named environment from `gribble.yaml` (`--env`). |
| `update-baseline` | `false` | Write `.gribble/baseline/` back on pushes to the default branch. |
| `comment` | `true` | Maintain pull request comments. |
| `max-comments` | `5` | Cap for new per-finding review comments per run. |
| `fail-on` | `error` | Fail the step when a new finding reaches this severity: `critical`, `error`, `warn`, `none`. |
| `github-token` | `${{ github.token }}` | Token for the check run, comments and baseline write-back. |
| `report-artifact` | `true` | Upload the `gribble-report` artifact. |

## Outputs

| Output | Description |
| --- | --- |
| `gate` | `pass` or `fail` as reported by gribble (independent of `fail-on`). |
| `new-findings` | Number of new findings relative to the baseline. |
| `report-path` | Absolute path of the report JSON. |
| `sarif-path` | Absolute path of `gribble.sarif`; feed it to `github/codeql-action/upload-sarif` if you want findings in the Security tab. |

## Permissions

| Feature | Permission |
| --- | --- |
| Check run + annotations | `checks: write` |
| Pull request comments | `pull-requests: write` |
| Baseline write-back (`baseline.update: commit`) | `contents: write` |
| Baseline write-back (`baseline.update: pr`) | `contents: write`, `pull-requests: write` |

Pushes made with `GITHUB_TOKEN` do not trigger other workflows; the baseline commit carries `[skip ci]` anyway.

## Baseline write-back

With `update-baseline: true` on a push to the default branch the audit runs with `--update-baseline`, then the action looks at `baseline.update` in `gribble.yaml`:

- `commit` (default): commits `.gribble/baseline/` as `github-actions[bot]` with `chore(gribble): update baseline [skip ci]` and pushes to the branch.
- `pr`: pushes a `gribble/baseline-<sha7>` branch and opens a chore pull request.
- `manual`: leaves the working tree alone; run `gribble baseline update` locally and commit.

## Monorepos

Set `all: true` (or `target: apps/web`) and the action audits every app with its own `.gribble/` in one job. The summary comment gets one section per app, fingerprints include the app name, and `max-comments` applies across all apps.

## Publishing to `gribble-dev/action`

`dist/` is git-ignored in the monorepo. The action is consumed from a mirror repository that contains the built file:

1. `pnpm --filter @gribble/action build` produces `packages/action/dist/index.js` (all dependencies inlined, ESM).
2. Copy `action.yml`, `README.md`, `LICENSE` and `dist/` into a checkout of `gribble-dev/action`, commit them there (dist is committed in the mirror), and tag `vX.Y.Z`.
3. Move the floating major tag (`v1`) to the new release so `uses: gribble-dev/action@v1` picks it up.

A release workflow in this repository can automate steps 2 and 3 after `changeset publish`.
