# gribble

## 0.4.0

### Minor Changes

- f77e33b: `environments.<name>.rules` in `gribble.yaml` takes the same map as `rules` in `rules.yaml` and is applied after presets, the directory cascade and per-route `overrides` when that environment is selected with `--env`. A preview deployment that sends `noindex` by design can now switch `seo/robots-noindex` off for itself while production keeps it on. Unknown rule ids under it get the same "unknown rule" error as `rules.yaml`, and the resolved rules now remember where each setting came from (`ResolvedRules.source()`, e.g. `environments.preview.rules`).
  
  `gribble audit` warns once at startup when an enabled rule has no checker yet (`implemented: false` in the registry), naming the rules, instead of accepting the setting in silence and never running it.
- 35ac2ba: `gribble explain <rule>` now reports what the current project makes of the rule, not just the registry entry. Run at or below a directory holding `.gribble/gribble.yaml`, it appends the effective severity, the `Source:` that settled it (a preset, a `rules.yaml` in the cascade, or `environments.<name>.rules`), the options when they differ from the registry defaults, and the route globs an `overrides` block re-settles it on. An enabled rule whose checker does not exist yet reads as `Effective: warn (no checker yet, so it will not run)`.
  
  The new `--env <name>` option resolves the rule for an environment the way `audit --env <name>` does, and fails with the same error on an environment that is not defined. Outside a project nothing is appended, so `explain` stays usable as a plain reference.
- ea6b748: The AI review runtime is now an optional peer dependency, so gate-only installs stop shipping it
  
  `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent` and (in `@gribble/core`) `@earendil-works/pi-agent-core` move from `dependencies` to `peerDependencies` with `peerDependenciesMeta.optional`, and every value import of them became a lazy `import()` that only runs when review mode is actually reached. A plain `npm install gribble` drops from 259 packages to 142 — no provider SDKs, no AWS Bedrock credential chain — which is what `--mode gate` in CI wanted all along.
  
  **This changes what an upgrade installs.** No package manager adds optional peers on its own, so anyone running `--mode review`, `--mode all`, `gribble login`, `gribble logout` or `gribble models` must install the runtime explicitly:
  
  ```bash
  npm install @earendil-works/pi-ai @earendil-works/pi-coding-agent
  ```
  
  Reaching those paths without it now fails with that exact command, pinned to the version Gribble expects, instead of a module-resolution stack trace. The GitHub Action's npx fallback and the Docker image install the runtime themselves, so review keeps working out of the box there.

### Patch Changes

- 918f476: A check that could not run no longer looks like a pass. `check:end` events now carry `ok` and `error`, the way `flow:end` does; when Lighthouse cannot start (a missing CDP port, a module that fails to load, a timeout) the CLI prints `✗ perf/* /route: <reason>` instead of `✓`, and the report gains an optional `notRun` list (`rule`, `route`, `reason`) so CI can tell "perf passed" from "perf never executed". The terminal summary adds a `Not run: …` line per reason. The gate itself is unchanged: an unexecuted check still does not fail it.
  
  Page rules no longer run against non-HTML responses. When a route in `target.routes` answers with a content type other than `text/html` or `application/xhtml+xml` (a sitemap, a feed, JSON), `html/*`, `seo/*`, `links/*`, `ui/*`, `i18n/*`, `a11y/*` and `perf/*` are skipped for that route and recorded under `notRun`, instead of failing the gate with missing doctype, title and viewport findings. `network/*` and `security/*` still run. A missing `Content-Type` header keeps the old behaviour.
- 7f754b1: `gribble login` (and the login step of `gribble init`) no longer hangs after a successful OAuth sign-in. pi races its "paste the authorization code" prompt against the localhost callback and aborts the prompt once the browser redirect wins; the CLI ignored that abort, so the prompt kept stdin open and the process never exited even though the credentials were already stored. The auth URL is also printed as a plain log line instead of a boxed note, so a long URL survives copy and paste out of the terminal.
  
  `gribble login` now opens the OAuth sign-in page in the browser on an interactive terminal, the way pi's own CLI does. The URL is still printed for the remote-machine case.
- 52579ec: The progress spinner is now Gribble's own single-row renderer instead of clack's: it re-fits the message to the terminal width on every frame, so resizing the window mid-audit no longer turns each update into a new line.
- Updated dependencies [918f476]
- Updated dependencies [f77e33b]
- Updated dependencies [ea6b748]
- Updated dependencies [b4e7ee5]
- Updated dependencies [245e87b]
- Updated dependencies [b3dc17d]
- Updated dependencies [1596985]
  - @gribble/core@0.4.0
  - @gribble/skills@0.4.0

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
