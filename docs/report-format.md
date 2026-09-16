---
title: Report format
description: The report JSON, its versioning guarantees, and the SARIF, JUnit and GitLab Code Quality outputs derived from it.
order: 61
---

Every audit produces one JSON document. It is the single source of truth: the terminal summary, the PR comments, the check annotations, SARIF, JUnit, GitLab Code Quality and the baseline update are all derived from it, and nothing consumes anything else.

```
.gribble/runs/
  2025-03-02T14-21-08Z/
    report.json
    gribble.sarif
    gribble-junit.xml
    gl-code-quality.json
    snapshots/
    screenshots/
    traces/
  latest.json          always the most recent report.json
```

`.gribble/runs/latest.json` is written on every run, whatever flags you pass. That is the path the [coding-agent skill](/docs/skills) and the [GitHub Action](/docs/ci-github-action) read. `output.keep` in `gribble.yaml` controls how many timestamped run directories survive before the oldest are pruned.

## Annotated example

```json
{
  "version": 1,
  "gribbleVersion": "1.4.0",
  "generatedAt": "2025-03-02T14:21:08.412Z",
  "mode": "all",

  "target": {
    "name": "apps/web",
    "url": "http://localhost:3000",
    "environment": "preview"
  },

  "repo": {
    "remote": "git@github.com:acme/storefront.git",
    "branch": "feat/new-pricing",
    "commit": "c41f8b2e9a7d3f05",
    "baseCommit": "3f9a21c0d8e4b6a1"
  },

  "model": {
    "provider": "<provider>",
    "id": "<model>",
    "thinking": "medium"
  },

  "budget": {
    "steps": 148,
    "maxSteps": 200,
    "tokens": 318204,
    "maxTokens": 2000000,
    "costUsd": 0.42
  },

  "baseline": {
    "present": true,
    "commit": "3f9a21c0d8e4b6a1",
    "bootstrap": false
  },

  "summary": {
    "counts": { "critical": 0, "error": 2, "warn": 2, "info": 1 },
    "newCount": 5,
    "existingCount": 3,
    "fixedCount": 1,
    "gate": "fail",
    "headline": "The gribbles found 4 holes in your hull — 2 need patching before you sail."
  },

  "findings": [
    {
      "fingerprint": "9f2c1d4a7b3e0c58",
      "rule": "links/broken",
      "severity": "error",
      "source": "deterministic",
      "status": "new",
      "title": "Internal link returns 404",
      "message": "The link to /docs/plans in the pricing table returns HTTP 404.",
      "route": "/pricing",
      "viewport": "desktop",
      "location": {
        "file": "src/components/PlanTable.tsx",
        "symbol": "PlanTable",
        "selector": "[data-testid=plan-compare-link]"
      },
      "subject": "http://localhost:3000/docs/plans",
      "suggestion": "The page was renamed to /docs/pricing-plans in #812. Update the href or add a redirect.",
      "evidence": {
        "url": "http://localhost:3000/pricing",
        "snippet": "<a href=\"/docs/plans\">Compare plans</a>"
      },
      "docsUrl": "https://gribble.dev/rules/links/broken"
    },
    {
      "fingerprint": "4d81a0ff26b7c913",
      "rule": "review/copy",
      "severity": "warn",
      "source": "ai",
      "confidence": 0.82,
      "status": "new",
      "title": "Inconsistent call-to-action wording",
      "message": "The pricing page uses \"Contact sales\" in the header and \"Talk to sales\" in the enterprise card. guidelines.md requires one term per concept.",
      "route": "/pricing",
      "location": { "file": "src/routes/pricing/EnterpriseCard.tsx", "symbol": "EnterpriseCard" },
      "subject": "contact-sales-cta",
      "suggestion": "Use \"Contact sales\" in both places.",
      "evidence": { "screenshot": "screenshots/pricing@desktop.webp" },
      "docsUrl": "https://gribble.dev/rules/review/copy"
    }
  ],

  "routes": [
    {
      "route": "/pricing",
      "url": "http://localhost:3000/pricing",
      "status": 200,
      "metrics": {
        "lcpMs": 2210,
        "cls": 0.02,
        "tbtMs": 180,
        "lighthousePerformance": 81,
        "pageWeightKb": 1310,
        "requestCount": 58
      },
      "snapshot": "snapshots/pricing.aria.yaml",
      "screenshots": {
        "mobile": "screenshots/pricing@mobile.webp",
        "desktop": "screenshots/pricing@desktop.webp"
      }
    }
  ],

  "flows": [
    { "name": "smoke",    "ok": true,  "kind": "replay", "durationMs": 4120, "steps": 9 },
    { "name": "checkout", "ok": false, "kind": "replay", "durationMs": 18340, "steps": 11,
      "error": "Step 8 (expect_text \"Order summary\"): timed out after 5000ms" }
  ],

  "notRun": [
    { "rule": "perf/*", "route": "/pricing",
      "reason": "Lighthouse could not run: Cannot find module 'tslib'" }
  ],

  "durationMs": 94210
}
```

## Field reference

### Top level

| Field | Type | Description |
| --- | --- | --- |
| `version` | `1` | Report schema version. See [versioning](#versioning). |
| `gribbleVersion` | string | The Gribble release that produced this report. |
| `generatedAt` | ISO string | When the run finished. |
| `mode` | `gate` \| `review` \| `all` | Which halves ran. |
| `target` | object | `name` (empty for a single-app repo, else a path like `apps/web`), `url`, optional `environment`. |
| `repo` | object? | `remote`, `branch`, `commit`, `baseCommit`. Absent outside a git repository. |
| `model` | object? | `provider`, `id`, optional `thinking`. Absent in `--mode gate`. |
| `budget` | object | Actual and maximum `steps`, `tokens`, plus `costUsd`. |
| `baseline` | object | `present`, the baseline's `commit`, and `bootstrap`. |
| `summary` | object | See below. |
| `findings` | Finding[] | All findings, deduped and sorted. |
| `routes` | RouteResult[] | One entry per audited route. |
| `flows` | FlowResult[] | One entry per flow that ran. |
| `notRun` | NotRunCheck[]? | Checks that could not run. Absent when every check ran. |
| `durationMs` | number | Wall-clock duration of the audit. |

`baseline.bootstrap` is `true` when there was no baseline and this run created one. Consumers should suppress comments and pass the gate in that case.

### `summary`

| Field | Type | Description |
| --- | --- | --- |
| `counts` | object | Findings by severity, **over status `new` only**. |
| `newCount` | number | Findings not in the baseline. |
| `existingCount` | number | Findings already in the baseline. Counted, never commented. |
| `fixedCount` | number | Baseline findings that have disappeared. |
| `gate` | `pass` \| `fail` | `fail` when a **new** finding has severity `error` or `critical` **and** comes from a deterministic rule or `flows/replay`. |
| `headline` | string | One human sentence for the top of a comment or terminal summary. |

`counts` covering only new findings is deliberate: a repository with 400 known accessibility findings should show `error: 0` on a PR that introduced none.

### `findings[]`

Full treatment in [Findings](/docs/concepts/findings). In short: `fingerprint` is a stable 16-hex-character identity computed in code; `source` is `deterministic` or `ai`; `confidence` appears on AI findings only; `status` is filled by the baseline diff; `location` carries `file` and `symbol` rather than line numbers, so it survives refactors.

### `routes[]`

| Field | Type | Description |
| --- | --- | --- |
| `route` | string | Normalized path, e.g. `/blog/[slug]`. |
| `url` | string | The URL actually visited. |
| `status` | number? | HTTP status of the document response. |
| `metrics` | RouteMetrics? | `lcpMs`, `cls`, `tbtMs`, `lighthousePerformance`, `pageWeightKb`, `requestCount`. |
| `snapshot` | string? | Path to the aria snapshot within the run directory. |
| `screenshots` | object? | Viewport name to image path within the run directory. |

These are the numbers `perf/regression` compares against `baseline/metrics.json`, and they are recorded for every route whether or not a threshold was crossed — so the history is there even for routes nobody complained about.

### `flows[]`

| Field | Type | Description |
| --- | --- | --- |
| `name` | string | Flow name from its frontmatter. |
| `ok` | boolean | Whether the journey completed. |
| `kind` | `replay` \| `ai` | Deterministic replay of a recorded sidecar, or an agent walking the prose. |
| `durationMs` | number | How long it took. Drives `flows/max-duration`. |
| `steps` | number? | Steps executed. |
| `error` | string? | For a failure: which step, which action, what was expected. |

A failed flow also produces a `flows/replay` finding. `flows[]` is the execution record; `findings[]` is the thing you act on.

### `notRun[]`

| Field | Type | Description |
| --- | --- | --- |
| `rule` | string | The rule family that did not run, e.g. `perf/*` or `html/*`. |
| `route` | string? | The route it was skipped on. Absent for site-wide checks such as `site/*`. |
| `reason` | string | Why: Lighthouse failed to start, the response was not HTML, a check threw. |

A check that never ran contributes no findings, so a clean `findings[]` alone cannot tell "perf passed" from "perf never executed". `notRun[]` records the difference: Lighthouse that could not start on a route, the page rules skipped on a non-HTML response such as a sitemap, or a check that threw. The list is omitted when everything ran. It does not affect `summary.gate`; whether an unexecuted check should fail the gate is a policy decision tracked separately.

## Versioning

`version` is the **report schema** version and is independent of `gribbleVersion`. Within `version: 1`:

- **Fields are never removed and never change meaning.** A consumer written today keeps working.
- **New optional fields may be added** in any release. Parse leniently; ignore what you do not recognise.
- **Enum values may gain members.** New rule ids, new viewport names, new `AuditEvent` types. Handle unknown values without crashing.

A breaking change bumps `version` to `2`, and Gribble will read both for at least one major release.

The JSON Schema is published at [`https://gribble.dev/schema/report.json`](https://gribble.dev/schema/report.json) and generated from the same TypeBox definitions Gribble validates with, so it cannot drift from what the code produces.

```ts
import type { Report, Finding } from "@gribble/core";

const report: Report = JSON.parse(await readFile(".gribble/runs/latest.json", "utf8"));
const blocking = report.findings.filter(
  (f) => f.status === "new" && (f.severity === "error" || f.severity === "critical"),
);
```

## Self-contained by design

A report explains itself with no access to the repository that produced it. It carries the Gribble version, the model, the target URL and environment, the git remote, branch, commit and base commit, the baseline commit it was compared against, and the budget actually consumed.

That is enough to answer, months later, from a downloaded artifact alone: which commit, which model, which baseline, how much did it cost, and what was the site at the time.

Two consequences worth planning for:

- **Uploadable.** Gribble is local-only today — no cloud, no account, no telemetry. But a report is a complete, versioned, self-describing document, so a hosted dashboard could ingest one without needing repository access. That path is kept open deliberately; nothing about it is required to use Gribble.
- **Treat it as sensitive.** A report can contain page content, screenshots and URLs from a logged-in session. Values of environment variables named in [auth profiles](/docs/auth) are redacted, but a report from a staging site is still internal data. `.gribble/runs/` is gitignored by default; look before you attach one to a public issue.

## Derived outputs

All three are written next to `report.json` in the run directory when `--ci` is set, and all three are projections of it. Nothing appears in them that is not in the JSON.

### SARIF

`gribble.sarif`, SARIF 2.1.0. Each finding becomes one result: the rule id becomes the SARIF rule, `docsUrl` its help URI, `location.file` the artifact location, `message` the result message, and severity maps to SARIF levels — `critical` and `error` to `error`, `warn` to `warning`, `info` to `note`.

```yaml
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: gribble.sarif
```

Findings then appear in the repository's Security tab with GitHub's own dedupe and dismissal on top. `if: always()` matters — without it a failed gate skips the upload and you lose the results you wanted.

### JUnit

`gribble-junit.xml`, for test reporters and dashboards that speak JUnit. One test case per finding, grouped into suites by rule category, with the route in the case name and the message and suggestion in the failure body. Flow results appear as cases too, so a broken journey shows up as a failed test rather than only as a finding.

### GitLab Code Quality

`gl-code-quality.json`, the [Code Quality report](https://docs.gitlab.com/ci/testing/code_quality/) GitLab reads from `artifacts:reports:codequality`. A JSON array with one issue per active finding:

```json
[
  {
    "type": "issue",
    "check_name": "links/broken",
    "description": "Link to /pricing-old returns 404 (/)",
    "content": { "body": "…message, subject, fix and docs link…" },
    "categories": ["links"],
    "severity": "major",
    "fingerprint": "3f9a1c0e7b2d4a58",
    "location": { "path": "src/components/Footer.tsx", "lines": { "begin": 1 } }
  }
]
```

- `fingerprint` is the finding's own fingerprint. GitLab diffs the merge request's report against the target branch's by this field, so its new/fixed counts agree with Gribble's.
- `severity` maps `critical → critical`, `error → major`, `warn → minor`, `info → info`. GitLab's `blocker` is never used.
- `location.path` is `location.file` when the finding was mapped to source, otherwise the route. `lines.begin` is always `1`: Gribble locates by symbol, not by line.
- `description` is the title, with the route appended when the path is a file so the widget still says which page it was seen on. The message, subject, suggestion and docs link go in `content.body`.
- Fixed findings are omitted, as in SARIF and JUnit.

See [GitLab CI](/docs/ci-gitlab) for the pipeline that consumes it.

None of these formats can express everything the JSON does — per-route metrics, budget consumption, baseline status, confidence. Use them for integration, and the JSON when you want the whole picture.
