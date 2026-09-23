---
"@gribble/core": patch
---

Recorded `.replay.json` sidecars now replay on the next gate. `startUrl` is recorded as a path on the target (`/` when the flow's first step navigates) instead of whichever page the review agent happened to be on, and a start page that fails to load is a warning rather than a `flows/replay` failure when step 1 is a `navigate`; existing sidecars with absolute URLs keep working. Click and fill selectors use the full accessible name, computed without `aria-hidden` text, prefer a link's `href`, and are checked against the live page: the recorder keeps the first candidate that resolves to exactly the clicked element and writes no sidecar, with a warning, when none does. `AuditPage` gains an optional `matchSelector()`.
