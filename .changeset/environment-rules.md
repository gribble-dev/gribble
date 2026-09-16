---
"@gribble/core": minor
"gribble": minor
---

`environments.<name>.rules` in `gribble.yaml` takes the same map as `rules` in `rules.yaml` and is applied after presets, the directory cascade and per-route `overrides` when that environment is selected with `--env`. A preview deployment that sends `noindex` by design can now switch `seo/robots-noindex` off for itself while production keeps it on. Unknown rule ids under it get the same "unknown rule" error as `rules.yaml`, and the resolved rules now remember where each setting came from (`ResolvedRules.source()`, e.g. `environments.preview.rules`).

`gribble audit` warns once at startup when an enabled rule has no checker yet (`implemented: false` in the registry), naming the rules, instead of accepting the setting in silence and never running it.
