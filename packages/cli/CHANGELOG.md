# gribble

## 0.3.0

### Minor Changes

- 47a362a: `--ci` now also writes `gl-code-quality.json`, a GitLab Code Quality report, next to `gribble.sarif` and `gribble-junit.xml`. `toCodeQuality(report)` is exported from `@gribble/core`. A new [GitLab CI](https://gribble.dev/docs/ci-gitlab) page shows the pipeline that feeds it to the merge request widget.

### Patch Changes

- 8b6cd85: `gribble install` finds Playwright's CLI again: `playwright/cli.js` is not in Playwright's `exports` map, so the CLI is now located next to the resolved `playwright/package.json` instead of being resolved as a package specifier. The GitHub Action is published to `gribble-dev/action` on every release (`uses: gribble-dev/action@v1`), declares the `node24` runtime, and shares the CLI's version. The CI documentation gains the `sarif-path` output, the runtime and `npx` fallback notes, and the Docker image's moving major tag.
- bac6bb1: Keep the progress spinner on one terminal row on narrow terminals (long messages are truncated instead of wrapping and leaving stale rows behind), and include `budget.max_cost_usd` in the 75% budget notice so the model is asked to finalize before a dollar cap ends the review.
- Updated dependencies [47a362a]
- Updated dependencies [bac6bb1]
  - @gribble/core@0.3.0
  - @gribble/skills@0.3.0

## 0.2.1

### Patch Changes

- 37bf37d: A `target.start` command that exits before the site responds now fails the audit with a clear message and exit code 2, instead of Node quitting mid-await with exit code 13.
- Updated dependencies [37bf37d]
- Updated dependencies [18b3fa0]
  - @gribble/core@0.2.1
  - @gribble/skills@0.2.1

## 0.2.0

### Minor Changes

- f9a0629: First release: CLI (`init`, `audit`, `login`, `install`, `ignore`, `explain`, `baseline update`, `models`), pi-based review agent with browser, crawl, perf, a11y, SEO, visual, repo, flow and report tool packs, deterministic gate checks, baselines, GitHub Action, and coding-agent skills.

### Patch Changes

- Updated dependencies [f9a0629]
  - @gribble/core@0.2.0
  - @gribble/skills@0.2.0
