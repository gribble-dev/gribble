---
"@gribble/core": patch
---

`security/headers` now accepts a `content-security-policy` delivered as `<meta http-equiv="content-security-policy">` in the document when the response has no such header, the way prerendered pages (SvelteKit with `kit.csp`, for one) ship their policy. The attribute is matched case-insensitively and an empty `content` does not count. Only CSP has this fallback; `x-content-type-options`, `strict-transport-security` and every other header stay header-only. When the meta form satisfies the rule, the audit logs an info note once per run that a meta policy cannot carry `frame-ancestors`, `report-uri` or `sandbox`, and a finding for the remaining headers on that route carries the same note and the meta tag in its evidence.

The rule's existing skip on loopback targets is now visible: it is recorded under `notRun` in the report (`security/headers` on each route, reason "target is a loopback address"), so a green local run no longer reads as a pass, and the registry description behind `gribble explain` and the rules reference says so. Checks can record such per-rule skips through the new optional `CheckContext.notRun`, which `runRouteChecks` returns as the route's `notRun`.
