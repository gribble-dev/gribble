---
title: GitLab CI
description: Run Gribble in a GitLab pipeline with the Docker image, and let the merge request widget show findings through Code Quality and JUnit reports.
order: 51
---

There is no GitLab-specific integration and none is needed for the first mile. `gribble audit --ci` writes three files GitLab already knows how to read, so a merge request shows new and fixed findings in its Code Quality widget, annotates the diff where a finding maps to a source file, and lists every finding under the Tests tab — without a token, an API call or a bot account.

The [Docker image](#the-docker-image) has Gribble and its browser preinstalled, which keeps the job to two lines.

## A complete pipeline

Two jobs. Merge request pipelines audit the branch; pushes to the default branch refresh the baseline and produce the report GitLab compares merge requests against.

```yaml
# .gitlab-ci.yml
stages: [test]

.gribble:
  stage: test
  image: ghcr.io/gribble-dev/gribble:latest   # pin a version in real pipelines
  before_script:
    - pnpm install --frozen-lockfile           # only needed when target.start runs your dev server
  artifacts:
    when: always                               # a failed gate must still upload its reports
    paths:
      - .gribble/runs/
    reports:
      codequality: .gribble/runs/*/gl-code-quality.json
      junit: .gribble/runs/*/gribble-junit.xml

gribble:audit:
  extends: .gribble
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    - gribble audit --ci --mode gate > gribble-report.json
  artifacts:
    paths:
      - gribble-report.json
      - .gribble/runs/

gribble:baseline:
  extends: .gribble
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script:
    - gribble audit --ci --mode gate --update-baseline > gribble-report.json
    - git add .gribble/baseline
    - git config user.name gribble
    - git config user.email gribble@users.noreply.gitlab.com
    - 'git commit -m "chore: update gribble baseline [skip ci]" || exit 0'
    - git push "https://oauth2:${GRIBBLE_PUSH_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git" "HEAD:${CI_COMMIT_BRANCH}"
```

A few choices in there worth explaining.

**`when: always`** on the artifacts is the one line you cannot leave out. A failed gate exits `1`, GitLab marks the job failed, and without `when: always` it also skips the upload — so the run that found something is the run whose findings you never see.

**The baseline job also uploads a Code Quality report.** GitLab computes "new" and "fixed" by comparing the merge request's report with the most recent report from the target branch. If the default branch never produces one, the widget lists every finding as new on every merge request. Running the audit on the default branch gives GitLab its reference and refreshes the [baseline](/docs/concepts/baseline) in the same run.

**`mode: gate`** in both jobs is deliberate. Gate is deterministic and needs no model, so the pipeline needs no provider key — and no model runtime: the pi packages are [optional peer dependencies](/docs/getting-started#the-review-runtime-is-optional), so a gate-only `pnpm install` from a fresh lockfile never fetches them. A lockfile that already held them from Gribble 0.3 keeps them across the upgrade; see [Upgrading from 0.3](/docs/getting-started#upgrading-from-0-3). See [Review mode in CI](#review-mode-in-ci) for the alternative.

**Pushing the baseline needs a token.** `CI_JOB_TOKEN` cannot push. Create a [project access token](https://docs.gitlab.com/user/project/settings/project_access_tokens/) with the `write_repository` scope and the Developer role, store it as a masked, protected CI/CD variable named `GRIBBLE_PUSH_TOKEN`, and allow that token to push to the default branch in the branch protection settings. `[skip ci]` in the commit message keeps the push from starting another pipeline. If you would rather not let CI write to your branch, set `baseline.update: manual` in `gribble.yaml`, drop the `git` lines, and run `gribble baseline update` locally.

**`pnpm install`** is only there for `target.start`. If `gribble.yaml` points at a deployed preview URL instead of starting a dev server, remove the `before_script` and the job runs without installing anything.

## What the merge request shows

Three surfaces, all fed by files in the run directory.

| Surface | Source file | What appears |
| --- | --- | --- |
| Code Quality widget | `gl-code-quality.json` | Findings new in this merge request and findings it fixed, compared with the target branch by fingerprint. Expands into the full list. |
| Diff annotations | `gl-code-quality.json` | A marker in the changes view on files that carry a finding with a `location.file` — the gutter icon GitLab uses for its own code quality scanners. |
| Tests tab | `gribble-junit.xml` | One suite per rule, one case per finding; `critical` and `error` findings are failures. New failures relative to the target branch are called out. |

The full [report JSON](/docs/report-format) is uploaded as a plain artifact too, for anything that wants more than the widget can show: per-route metrics, baseline status, confidence, evidence.

### How findings map onto Code Quality

The Code Quality format was designed for linters, so a couple of translations are involved. They are spelled out in [Report format](/docs/report-format#gitlab-code-quality); the parts that affect how you read the widget:

- Severity maps `critical → critical`, `error → major`, `warn → minor`, `info → info`.
- `location.path` is the source file when Gribble mapped the finding to one, otherwise the route (`/pricing`, `/blog/[slug]`). GitLab shows the route as a path it cannot open; that is expected, and the description names the route too.
- Line numbers are always `1`. Gribble locates by component or symbol, never by line, so the diff marker lands at the top of the file.
- The fingerprint is Gribble's own, which is what makes the new/fixed comparison agree with `gribble` itself.

## Review mode in CI

Gate needs no model. Review does, and it costs tokens, so it earns a separate job that is allowed to fail.

It also needs the runtime on disk. Add `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` to the audited repository's devDependencies before enabling this job; no package manager installs an optional peer for you, and the job would otherwise fail with the install command instead of a report.

```yaml
gribble:review:
  extends: .gribble
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  allow_failure: true
  script:
    - gribble audit --ci --mode review --env preview > gribble-report.json
```

Set the provider key named in your `gribble.yaml` model configuration as a masked CI/CD variable; [Auth](/docs/auth#part-2-model-provider-auth) lists the variable each provider reads. `--env preview` matters for two reasons: it selects the `environments.preview` target in `gribble.yaml`, and it tells the [side-effect guard](/docs/concepts/gate-and-review#guardrails) that clicking "place order" here is acceptable. Never point review mode at production without that guard in place.

Review-mode findings have `source: "ai"` and land in the same three files, so they appear in the widget alongside gate findings. If you would rather keep them out of the Code Quality comparison, give the review job its own artifact paths and skip the `reports:` block.

## Auditing a deployed preview

When your platform deploys a review app per merge request, audit that instead of starting a dev server. Reference the URL through an environment variable so the same configuration serves local runs:

```yaml
# gribble.yaml
target:
  url: http://localhost:3000
  start: pnpm dev
environments:
  preview:
    target:
      url: ${REVIEW_APP_URL}
```

```yaml
gribble:audit:
  extends: .gribble
  needs: [deploy:review]
  before_script: []
  variables:
    REVIEW_APP_URL: https://$CI_ENVIRONMENT_SLUG.example.com
  script:
    - gribble audit --ci --mode gate --env preview > gribble-report.json
```

Add the preview host to `allowed_origins` in `gribble.yaml`, or the crawler will refuse to leave the page it started on.

## Authenticated routes

Credentials come from CI/CD variables, never from the flow files. Declare the variable names in the auth profile and mark the variables masked:

```yaml
# gribble.yaml
auth:
  profiles:
    user:
      type: flow
      flow: flows/auth/login.md
      env: { email: GRIBBLE_USER_EMAIL, password: GRIBBLE_USER_PASSWORD }
```

Values of those variables are redacted from the report and the session log before either is written, so the artifacts are safe to keep. See [Auth](/docs/auth).

## The Docker image

`ghcr.io/gribble-dev/gribble` is built from the official Playwright image, so the browser and its system libraries are already there and the job skips `gribble install`. Tags follow the npm package version; `latest` tracks the newest release.

```yaml
image: ghcr.io/gribble-dev/gribble:0.2.1
```

The image ships `pnpm` through corepack and Node from the Playwright base, and `gribble` is installed globally. If your project also has `gribble` as a devDependency, `pnpm exec gribble` runs the project's copy instead — either works, but pin them to the same version so the report your teammates see locally is the one CI produced.

Without the image, use any Playwright base (`mcr.microsoft.com/playwright:<version>-noble`) and install the CLI from your lockfile; a plain Node image works too, but `gribble install` then has to download the browser on every run.

## Monorepos

The CLI flags are the same as anywhere else: `--target apps/web` audits one app, `--all` audits every `.gribble/` directory it finds, and each target writes its own run directory under its own `.gribble/`. Point the `reports:` globs at every app you audit:

```yaml
  artifacts:
    reports:
      codequality: apps/*/.gribble/runs/*/gl-code-quality.json
      junit: apps/*/.gribble/runs/*/gribble-junit.xml
```

See [Monorepos](/docs/monorepos).

## What is not here yet

There is no merge request comment integration: GitLab's widget and diff markers carry the findings instead, and the Action's in-place summary comment has no GitLab counterpart. Baseline updates are a `git push` from the job rather than an opened merge request. Both are on the list; until then the CLI, the Docker image and GitLab's own report artifacts are the whole integration, and they are enough to fail a pipeline on a broken link.
