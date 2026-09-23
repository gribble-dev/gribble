---
"@gribble/core": minor
"gribble": minor
---

Reports now separate what executed from what was found. A new `completeness` section lists requested routes, flows and checks that did not run, each with a machine-readable reason code (`unreachable`, `auth-failed`, `replay-missing`, `budget-exhausted`, `excluded`, ...) that tells intentional exclusions from unexpected gaps; `notRun[]` entries gain the same `code` and `intentional` fields. `baseline.status` says whether findings were compared (`available`), recorded (`bootstrap`) or `not-comparable`, with the checked routes the baseline has never seen. The terminal and the PR comment print an Execution / Findings / Baseline / Unreached block.

New opt-in `coverage.required` in gribble.yaml (`routes`, `flows`, `checks`, `baseline`) fails the gate when required coverage did not execute. It is off by default, so exit codes and the first-run bootstrap behave as before; the AI review stays advisory.
