# Contributing to Gribble

## Conventions

- **Language:** every artifact is English. Code, comments, docs, CLI copy, templates, reports, commit messages, PR and issue text. No exceptions.
- **Tone:** cute, slightly funny, nautical + tiny-bug imagery. Jokes stop where the bug begins: findings (severity, file, fix) and error messages are dry and precise. The "ship" pun (vessel / release) is the house joke. Use 🪱 or 🐛 in the CLI; there is no gribble emoji.
- **Runtime:** Node >= 22, pnpm, ESM only, TypeScript strict.
- **Build:** tsdown. **Lint/format:** Biome (tabs, double quotes). **Tests:** Vitest. **Schemas:** TypeBox (`typebox` package, the same one pi uses) for config validation, tool parameters and JSON Schema export. Do not add a second schema library.
- **Versions:** all pi packages (`@earendil-works/pi-*`) are pinned to one exact version via the pnpm catalog in `pnpm-workspace.yaml`. Never patch pi internals; extend through `ResourceLoader`, inline extensions and `customTools`.
- **Releases:** Changesets, all packages share one version. Add a changeset to any PR that changes a published package; merging to main keeps a "chore: release" PR up to date, and merging *that* publishes to npm, tags, creates GitHub releases from the CHANGELOGs, and dispatches the Docker image and action mirror (see `.github/workflows/release.yml`). Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`...).
- **Layout:** `packages/` holds things published to npm or depended on by other packages; `apps/` holds things deployed but not published.

## Repository map

```
packages/core     @gribble/core   harness, tool packs, config/flows parsing, report schema
packages/cli      gribble         the CLI (bin: gribble)
packages/action   @gribble/action GitHub Action wrapping `gribble audit --ci`
packages/skills   @gribble/skills SKILL.md for coding agents + installer
apps/website                      gribble.dev, SvelteKit + Cloudflare Workers
docs/                             documentation source (rendered by the website, shipped in the npm package)
```

## Workflow

```bash
pnpm install
pnpm build            # builds packages/*
pnpm typecheck
pnpm test
pnpm lint             # biome check
pnpm changeset        # describe your change
```

## Rules

Every rule lives in the registry in `packages/core/src/rules/`. A rule has an id (`category/name`), a description, an option schema, a default severity per preset, examples and a fix hint. The registry drives `gribble explain <rule>`, the docs reference page (`pnpm docs:rules`) and the `https://gribble.dev/rules/<id>` links in findings.
