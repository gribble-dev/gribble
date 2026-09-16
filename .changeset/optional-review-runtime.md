---
"@gribble/core": minor
"gribble": minor
---

The AI review runtime is now an optional peer dependency, so gate-only installs stop shipping it

`@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent` and (in `@gribble/core`) `@earendil-works/pi-agent-core` move from `dependencies` to `peerDependencies` with `peerDependenciesMeta.optional`, and every value import of them became a lazy `import()` that only runs when review mode is actually reached. A plain `npm install gribble` drops from 259 packages to 142 — no provider SDKs, no AWS Bedrock credential chain — which is what `--mode gate` in CI wanted all along.

**This changes what an upgrade installs.** No package manager adds optional peers on its own, so anyone running `--mode review`, `--mode all`, `gribble login`, `gribble logout` or `gribble models` must install the runtime explicitly:

```bash
npm install @earendil-works/pi-ai @earendil-works/pi-coding-agent
```

Reaching those paths without it now fails with that exact command, pinned to the version Gribble expects, instead of a module-resolution stack trace. The GitHub Action's npx fallback and the Docker image install the runtime themselves, so review keeps working out of the box there.
