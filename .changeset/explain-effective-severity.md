---
"gribble": minor
---

`gribble explain <rule>` now reports what the current project makes of the rule, not just the registry entry. Run at or below a directory holding `.gribble/gribble.yaml`, it appends the effective severity, the `Source:` that settled it (a preset, a `rules.yaml` in the cascade, or `environments.<name>.rules`), the options when they differ from the registry defaults, and the route globs an `overrides` block re-settles it on. An enabled rule whose checker does not exist yet reads as `Effective: warn (no checker yet, so it will not run)`.

The new `--env <name>` option resolves the rule for an environment the way `audit --env <name>` does, and fails with the same error on an environment that is not defined. Outside a project nothing is appended, so `explain` stays usable as a plain reference.
