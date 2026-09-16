---
"@gribble/core": patch
---

`a11y/focus-visible`, `a11y/keyboard-reachable` and `html/deprecated-elements` are `off` in `gribble:recommended` instead of `warn`, because none of them has a checker yet. Since `gribble init` writes `extends: [gribble:recommended]`, every default install printed "3 enabled rules have no checker yet and will not run" on every audit, about rules the user never asked for. A default configuration is now quiet again, and the three rules keep their description, options and fix hint, so `gribble explain` still documents them until the checkers land.

The preset derivation enforces that as an invariant: a rule marked `implemented: false` is `off` in every built-in preset. `gribble:strict` already left `off` alone, but `gribble:a11y` promoted every `a11y/*` rule that was off in recommended — including `a11y/skip-link` and `a11y/reduced-motion` — straight into the same warning.
