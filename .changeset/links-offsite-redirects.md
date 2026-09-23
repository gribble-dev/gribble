---
"@gribble/core": patch
---

A same-origin link that redirects to another origin is now judged by where it lands. Its final host is checked against the `links/broken-external` `ignore` list, a 403, 429 or 999 from the other site is inconclusive, and any other failure is reported as `links/broken-external` (with the same-origin link as the subject) instead of `links/broken`. An affiliate hop such as `/go/partner` → a site that blocks bots no longer fails the audit as a broken internal link. Redirects that stay on the site, and `links/redirect-chain`, are unchanged.
