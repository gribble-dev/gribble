---
"@gribble/core": patch
"gribble": patch
---

A `target.start` command that exits before the site responds now fails the audit with a clear message and exit code 2, instead of Node quitting mid-await with exit code 13.
