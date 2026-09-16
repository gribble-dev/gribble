---
"@gribble/core": patch
"gribble": patch
---

A check that could not run no longer looks like a pass. `check:end` events now carry `ok` and `error`, the way `flow:end` does; when Lighthouse cannot start (a missing CDP port, a module that fails to load, a timeout) the CLI prints `✗ perf/* /route: <reason>` instead of `✓`, and the report gains an optional `notRun` list (`rule`, `route`, `reason`) so CI can tell "perf passed" from "perf never executed". The terminal summary adds a `Not run: …` line per reason. The gate itself is unchanged: an unexecuted check still does not fail it.

Page rules no longer run against non-HTML responses. When a route in `target.routes` answers with a content type other than `text/html` or `application/xhtml+xml` (a sitemap, a feed, JSON), `html/*`, `seo/*`, `links/*`, `ui/*`, `i18n/*`, `a11y/*` and `perf/*` are skipped for that route and recorded under `notRun`, instead of failing the gate with missing doctype, title and viewport findings. `network/*` and `security/*` still run. A missing `Content-Type` header keeps the old behaviour.
