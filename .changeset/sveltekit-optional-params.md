---
"@gribble/core": patch
---

SvelteKit route discovery now understands parameter matchers and optional parameters. `=matcher` is
stripped from every parameter form (`[lang=locale]` → `[lang]`, `[...path=asset]` → `[...path]`), so
renaming a validator in `src/params/` no longer orphans baseline entries, and `[[lang]]` segments
expand to both paths they serve — one `[[lang]]/about/+page.svelte` is discovered as `/about` and
`/[lang]/about`. An i18n site with the default locale at the root gets its canonical routes back,
home page included. A variant cap keeps a route with many optional parameters from expanding
combinatorially.
