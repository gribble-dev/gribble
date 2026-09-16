# @gribble/core

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
