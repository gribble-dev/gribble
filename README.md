<p align="center">
  <strong>🪱 Gribble</strong><br>
  <em>Tiny bugs that find your bugs before you ship.</em>
</p>

Gribble is an AI-driven website quality audit agent that runs **during development**: before a PR, in CI, and before a release. It walks every flow of your site like a picky code reviewer, checks broken links, UI best practices and your own guidelines, SEO, accessibility and performance, and points each finding at the source file that caused it.

A gribble is a tiny marine isopod that bores holes into ship hulls from places nobody looks. We named the pest hunter after the pest.

## Install

```bash
pnpm add -D gribble
pnpm exec gribble install   # downloads the Playwright browser
pnpm exec gribble init      # creates .gribble/ and (optionally) a skill for your coding agent
pnpm exec gribble audit     # let the gribbles chew on it
```

## How it works

- **gate** mode runs deterministic checks (links, network, SEO, axe, Lighthouse thresholds, UI hard rules, replay of fixed flows). Fast, reproducible, can block a merge.
- **review** mode lets an AI agent explore your site, walk the flows described in `.gribble/flows/*.md`, judge the UI against `.gribble/guidelines.md`, and propose fixes. It never blocks a merge; it comments.
- Everything is a **diff against the baseline** on `main`: new holes are reported, known ones are counted, patched ones are celebrated.

Gribble is a shell around [pi](https://github.com/earendil-works/pi): the agent loop, model catalog and auth come from pi's SDK, the audit tools and guardrails come from Gribble.

## Packages

| Package | Description |
| --- | --- |
| [`gribble`](packages/cli) | The CLI you install as a devDependency |
| [`@gribble/core`](packages/core) | Harness, tool packs, config and flow parsing, report schema |
| [`@gribble/action`](packages/action) | GitHub Action wrapper (`gribble-dev/action`) |
| [`@gribble/skills`](packages/skills) | Skill files that teach your coding agent to feed the gribbles |
| [`apps/website`](apps/website) | gribble.dev (SvelteKit on Cloudflare Workers) |

Documentation lives in [`docs/`](docs) and is published at https://gribble.dev/docs.

## Development

```bash
pnpm install
pnpm build
pnpm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions.

## License

MIT
