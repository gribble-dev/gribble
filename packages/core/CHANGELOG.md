# @gribble/core

## 0.5.1

No changes in this release.

## 0.5.0

### Minor Changes

- 9013151: Reports now separate what executed from what was found. A new `completeness` section lists requested routes, flows and checks that did not run, each with a machine-readable reason code (`unreachable`, `auth-failed`, `replay-missing`, `budget-exhausted`, `excluded`, ...) that tells intentional exclusions from unexpected gaps; `notRun[]` entries gain the same `code` and `intentional` fields. `baseline.status` says whether findings were compared (`available`), recorded (`bootstrap`) or `not-comparable`, with the checked routes the baseline has never seen. The terminal and the PR comment print an Execution / Findings / Baseline / Unreached block.
  
  New opt-in `coverage.required` in gribble.yaml (`routes`, `flows`, `checks`, `baseline`) fails the gate when required coverage did not execute. It is off by default, so exit codes and the first-run bootstrap behave as before; the AI review stays advisory.
- a600558: `gribble audit` no longer hangs when the dev server dies mid-crawl (#38). Stopping `target.start` used to signal only the shell Gribble spawned, and returned early once that shell had exited; a server it launched (a package manager wrapper, `a && b`, a runtime supervisor) survived, kept Gribble's stdout/stderr pipes open and kept the CLI alive after the audit. The whole process group is now signalled, waited on and killed if it lingers, and the CLI exits explicitly once its output is flushed instead of waiting for the event loop to drain. Closing pages and the browser is bounded as well.
  
  The audit also stops as soon as the target is gone: when the `target.start` process exits and `target.url` no longer answers, or when `target.maxConnectionFailures` (default `3`, `0` disables) page loads in a row fail with a connection error and the base URL is confirmed dead. `runAudit` rejects with the new `TargetGoneError` and writes neither a report nor a baseline, since every later route would read as a page error and every baseline finding on it as fixed. The CLI prints `error: the dev server is gone: …` followed by the server's last 40 lines of output and exits with the new code `4`; `DevServerError` carries the same `output` tail when the server never comes up. `DevServer` gains `unexpectedExit` and `outputTail()`, and the action names exit code `4` in its failure message.
- 50cac3e: The eleven rules that were accepted in `rules.yaml` but had no checker now run: `a11y/focus-visible`, `a11y/keyboard-reachable`, `a11y/skip-link`, `a11y/reduced-motion`, `ui/spacing-from-tokens`, `ui/empty-state`, `html/deprecated-elements`, `html/valid`, `security/form-without-csrf`, `i18n/mixed-language` and `i18n/lang-mismatch`. Their severity is unchanged: `off` in `gribble:recommended` and `gribble:strict`, so a default install reports nothing new; `gribble:a11y` switches the four `a11y/*` rules to `warn`, the way a focused preset already did for `seo/twitter-card`.
  
  All of them are deterministic and conservative. `a11y/focus-visible` focuses each visible control and compares its computed style before and after; `a11y/keyboard-reachable` reports `onclick`/`role="button"` elements Tab cannot reach, native controls with `tabindex="-1"` outside a roving-tabindex widget and positive `tabindex` values; `a11y/skip-link` only speaks up when at least five tabbable elements precede the main content; `a11y/reduced-motion` emulates `prefers-reduced-motion: reduce`, reports infinite or second-long animations and motion transitions that survive it, and restores the emulation afterwards. `ui/spacing-from-tokens` compares margins and paddings with the spacing tokens and lets browser defaults through; `ui/empty-state` reports visible tables and lists with zero rows and no explanatory text. `html/deprecated-elements` reports obsolete elements and presentational attributes; `html/valid` is an offline structural check of the served source (stray, mismatched and missing end tags, duplicate attributes, nested links, non-`<li>` list children, blocks inside `<p>`), not a network validator, and honours `ignore`. `security/form-without-csrf` reports same-origin POST forms with neither a token field nor a CSRF meta tag, unless every cookie for the target is SameSite. The two i18n rules classify text by Unicode script family, so `i18n/mixed-language` reports a page whose second script holds a fifth of the letters and `i18n/lang-mismatch` reports a URL locale segment or a `lang` attribute that contradicts the text; two languages in the same script are not detected.
  
  `AuditPage` gains an optional `documentSource()` that returns the body of the last document response, `renderRulesReference` and `rulesByCategory` accept an explicit rule list, and `unimplementedEnabledRules` takes an optional registry lookup so the warning stays testable now that every registered rule has a checker.

### Patch Changes

- 6eaa32c: `security/headers` now accepts a `content-security-policy` delivered as `<meta http-equiv="content-security-policy">` in the document when the response has no such header, the way prerendered pages (SvelteKit with `kit.csp`, for one) ship their policy. The attribute is matched case-insensitively and an empty `content` does not count. Only CSP has this fallback; `x-content-type-options`, `strict-transport-security` and every other header stay header-only. When the meta form satisfies the rule, the audit logs an info note once per run that a meta policy cannot carry `frame-ancestors`, `report-uri` or `sandbox`, and a finding for the remaining headers on that route carries the same note and the meta tag in its evidence.
  
  The rule's existing skip on loopback targets is now visible: it is recorded under `notRun` in the report (`security/headers` on each route, reason "target is a loopback address"), so a green local run no longer reads as a pass, and the registry description behind `gribble explain` and the rules reference says so. Checks can record such per-rule skips through the new optional `CheckContext.notRun`, which `runRouteChecks` returns as the route's `notRun`.
- 080e725: A same-origin link that redirects to another origin is now judged by where it lands. Its final host is checked against the `links/broken-external` `ignore` list, a 403, 429 or 999 from the other site is inconclusive, and any other failure is reported as `links/broken-external` (with the same-origin link as the subject) instead of `links/broken`. An affiliate hop such as `/go/partner` → a site that blocks bots no longer fails the audit as a broken internal link. Redirects that stay on the site, and `links/redirect-chain`, are unchanged.
- 0596a5b: Upgrading from 0.3 to 0.4 with pnpm keeps the AI review runtime installed, and now the docs and the gate say so. 0.3 shipped `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` as hard dependencies; pnpm resolves 0.4's optional peers against the existing lockfile, finds them there, and keeps them together with the provider SDKs and the AWS credential chain. `pnpm install` and `pnpm dedupe` leave them in place. Only a fresh resolution skips them, which is what the 0.4.0 changelog and the docs assumed.
  
  **If you upgraded from 0.3 with pnpm and only run `--mode gate`:** run `pnpm why @earendil-works/pi-ai`. If it is still listed under `gribble`, set `autoInstallPeers: false`, run `pnpm install`, remove the setting and run `pnpm install` again (read the lockfile diff: that first install re-resolves every auto-installed peer), or delete `pnpm-lock.yaml` and `node_modules` and reinstall. [Getting started](https://gribble.dev/docs/getting-started#upgrading-from-0-3) has the details, including the recipes that do not work.
  
  `gribble audit --mode gate` now warns once per run when `@earendil-works/pi-ai` resolves from inside the repository although no `package.json` at the repository root or in the audited app lists it. A runtime installed outside the repository, as in the Docker image or the npx fallback, is not reported. The claims in the docs that pnpm never fetches the runtime for a gate-only install are qualified to a fresh install.
- b2a0be3: Recorded `.replay.json` sidecars now replay on the next gate. `startUrl` is recorded as a path on the target (`/` when the flow's first step navigates) instead of whichever page the review agent happened to be on, and a start page that fails to load is a warning rather than a `flows/replay` failure when step 1 is a `navigate`; existing sidecars with absolute URLs keep working. Click and fill selectors use the full accessible name, computed without `aria-hidden` text, prefer a link's `href`, and are checked against the live page: the recorder keeps the first candidate that resolves to exactly the clicked element and writes no sidecar, with a warning, when none does. `AuditPage` gains an optional `matchSelector()`.

## 0.4.0

### Minor Changes

- f77e33b: `environments.<name>.rules` in `gribble.yaml` takes the same map as `rules` in `rules.yaml` and is applied after presets, the directory cascade and per-route `overrides` when that environment is selected with `--env`. A preview deployment that sends `noindex` by design can now switch `seo/robots-noindex` off for itself while production keeps it on. Unknown rule ids under it get the same "unknown rule" error as `rules.yaml`, and the resolved rules now remember where each setting came from (`ResolvedRules.source()`, e.g. `environments.preview.rules`).
  
  `gribble audit` warns once at startup when an enabled rule has no checker yet (`implemented: false` in the registry), naming the rules, instead of accepting the setting in silence and never running it.
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
- b4e7ee5: `a11y/focus-visible`, `a11y/keyboard-reachable` and `html/deprecated-elements` are `off` in `gribble:recommended` instead of `warn`, because none of them has a checker yet. Since `gribble init` writes `extends: [gribble:recommended]`, every default install printed "3 enabled rules have no checker yet and will not run" on every audit, about rules the user never asked for. A default configuration is now quiet again, and the three rules keep their description, options and fix hint, so `gribble explain` still documents them until the checkers land.
  
  The preset derivation enforces that as an invariant: a rule marked `implemented: false` is `off` in every built-in preset. `gribble:strict` already left `off` alone, but `gribble:a11y` promoted every `a11y/*` rule that was off in recommended — including `a11y/skip-link` and `a11y/reduced-motion` — straight into the same warning.
- 245e87b: Route discovery now handles optional and escaped syntax consistently across frameworks, instead of
  leaking it into route ids and baseline keys.
  
  - **Next.js and Nuxt page file names are cleaned like directories.** `pages/docs/[[...slug]].tsx`
    was discovered as `/docs/[[...slug]]`, double brackets and all, because only the directory part
    of the path went through normalization. Nuxt 2 `_id` directories were dropped as private folders
    for the same reason.
  - **Remix splats survive.** `blog.$.tsx` produced `/blog/[..splat]` — the literal-escape rule ate a
    dot from the splat it had just generated — which then compiled to a single required segment and
    matched `/blog/a` but not `/blog/a/b`.
  - **Next.js intercepting routes are skipped.** `app/feed/(.)photo/[id]/page.tsx` was discovered as
    `/feed/(.)photo/[id]`, a route whose parentheses can never match a real URL. It re-renders a
    route that exists elsewhere in the tree, so it is not a URL to audit.
  - **Optional segments expand everywhere, not just in SvelteKit.** Next.js `[[...slug]]` and Remix
    `($lang)` now emit both the absent and present forms, so `/docs` and `/about` are discovered
    alongside `/docs/[...slug]` and `/[lang]/about`.
  - **Rest parameters match zero segments.** `routePatternRegex("/docs/[...slug]")` now matches
    `/docs`, the way the frameworks route it.
- b3dc17d: `ui/overlap`, `ui/text-clipped` and `a11y/touch-target` no longer measure elements nobody can see. The page snapshot now gates on `Element.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })` instead of a hand-rolled `display`/`visibility`/`opacity` trio, which is the only probe that catches the contents of a closed `<details>`: Chromium hides those through the `::details-content` pseudo-element, so the descendant's own computed `content-visibility` still reads `visible`. A locale switcher parked inside a collapsed `<details>` no longer reports a phantom overlap against whatever sits beneath it.
  
  The visually-hidden idiom — a 1px box clipped with `clip: rect(0, 0, 0, 0)` or `clip-path: inset(50%)`, as Tailwind's `sr-only` and Bootstrap's `.visually-hidden` emit — is genuinely rendered, so it needs its own exemption: `ui/text-clipped` skips it before measuring and `a11y/touch-target` before comparing. A `<a href="#main" class="sr-only focus:not-sr-only">Skip to content</a>` skip link is no longer reported as a 1×1px target with clipped text, which is a relief, because `a11y/skip-link`'s fix hint asks for exactly that markup.
  
  `ui/overlap` additionally skips any target whose centre is buried under a non-interactive overlay, and `ui/text-clipped` shares the same visibility helpers as the rest of the snapshot rather than re-checking `display` and `visibility` on its own.
- 1596985: SvelteKit route discovery now understands parameter matchers and optional parameters. `=matcher` is
  stripped from every parameter form (`[lang=locale]` → `[lang]`, `[...path=asset]` → `[...path]`), so
  renaming a validator in `src/params/` no longer orphans baseline entries, and `[[lang]]` segments
  expand to both paths they serve — one `[[lang]]/about/+page.svelte` is discovered as `/about` and
  `/[lang]/about`. An i18n site with the default locale at the root gets its canonical routes back,
  home page included. A variant cap keeps a route with many optional parameters from expanding
  combinatorially.

## 0.3.0

### Minor Changes

- 47a362a: `--ci` now also writes `gl-code-quality.json`, a GitLab Code Quality report, next to `gribble.sarif` and `gribble-junit.xml`. `toCodeQuality(report)` is exported from `@gribble/core`. A new [GitLab CI](https://gribble.dev/docs/ci-gitlab) page shows the pipeline that feeds it to the merge request widget.

### Patch Changes

- bac6bb1: Keep the progress spinner on one terminal row on narrow terminals (long messages are truncated instead of wrapping and leaving stale rows behind), and include `budget.max_cost_usd` in the 75% budget notice so the model is asked to finalize before a dollar cap ends the review.

## 0.2.1

### Patch Changes

- 37bf37d: A `target.start` command that exits before the site responds now fails the audit with a clear message and exit code 2, instead of Node quitting mid-await with exit code 13.

## 0.2.0

### Minor Changes

- f9a0629: First release: CLI (`init`, `audit`, `login`, `install`, `ignore`, `explain`, `baseline update`, `models`), pi-based review agent with browser, crawl, perf, a11y, SEO, visual, repo, flow and report tool packs, deterministic gate checks, baselines, GitHub Action, and coding-agent skills.
