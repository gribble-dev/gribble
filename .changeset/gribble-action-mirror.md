---
"gribble": patch
---

`gribble install` finds Playwright's CLI again: `playwright/cli.js` is not in Playwright's `exports` map, so the CLI is now located next to the resolved `playwright/package.json` instead of being resolved as a package specifier. The GitHub Action is published to `gribble-dev/action` on every release (`uses: gribble-dev/action@v1`), declares the `node24` runtime, and shares the CLI's version. The CI documentation gains the `sarif-path` output, the runtime and `npx` fallback notes, and the Docker image's moving major tag.
