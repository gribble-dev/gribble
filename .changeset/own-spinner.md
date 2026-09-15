---
"gribble": patch
---

The progress spinner is now Gribble's own single-row renderer instead of clack's: it re-fits the message to the terminal width on every frame, so resizing the window mid-audit no longer turns each update into a new line.
