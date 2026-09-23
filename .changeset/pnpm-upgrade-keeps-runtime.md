---
"@gribble/core": patch
"gribble": patch
---

Upgrading from 0.3 to 0.4 with pnpm keeps the AI review runtime installed, and now the docs and the gate say so. 0.3 shipped `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` as hard dependencies; pnpm resolves 0.4's optional peers against the existing lockfile, finds them there, and keeps them together with the provider SDKs and the AWS credential chain. `pnpm install` and `pnpm dedupe` leave them in place. Only a fresh resolution skips them, which is what the 0.4.0 changelog and the docs assumed.

**If you upgraded from 0.3 with pnpm and only run `--mode gate`:** run `pnpm why @earendil-works/pi-ai`. If it is still listed under `gribble`, set `autoInstallPeers: false`, run `pnpm install`, remove the setting and run `pnpm install` again (read the lockfile diff: that first install re-resolves every auto-installed peer), or delete `pnpm-lock.yaml` and `node_modules` and reinstall. [Getting started](https://gribble.dev/docs/getting-started#upgrading-from-0-3) has the details, including the recipes that do not work.

`gribble audit --mode gate` now warns once per run when `@earendil-works/pi-ai` resolves from inside the repository although no `package.json` at the repository root or in the audited app lists it. A runtime installed outside the repository, as in the Docker image or the npx fallback, is not reported. The claims in the docs that pnpm never fetches the runtime for a gate-only install are qualified to a fresh install.
