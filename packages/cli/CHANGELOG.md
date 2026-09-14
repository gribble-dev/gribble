# gribble

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
