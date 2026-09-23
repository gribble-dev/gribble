# gribble

Tiny bugs that find your bugs before you ship.

`gribble` is the command-line interface for [Gribble](https://gribble.dev): deterministic quality checks (links, SEO, accessibility, performance, HTML, security) plus an AI reviewer that walks your flows, all driven from a `.gribble/` directory that lives in your repository.

## Install

```bash
pnpm add -D gribble
pnpm exec gribble install     # downloads the Playwright Chromium build
pnpm exec gribble init        # creates .gribble/ and picks a model
pnpm exec gribble audit       # lets the gribbles loose
```

The AI review runtime is an **optional peer dependency**, so that install carries the deterministic gate only — which is all `--mode gate` in CI needs. Add it for `review` and `all`:

```bash
pnpm add -D gribble @earendil-works/pi-ai @earendil-works/pi-coding-agent
```

No package manager installs optional peers by itself on a fresh install. Upgrading from 0.3 with pnpm keeps the runtime from the old lockfile; [here is how to drop it](https://gribble.dev/docs/getting-started#upgrading-from-0-3). Without them, `--mode review` stops with the exact install command. See [Getting started](https://gribble.dev/docs/getting-started#the-review-runtime-is-optional).

## Commands

| Command | Purpose |
| --- | --- |
| `init` | Create `.gribble/`, choose a model, install agent skills |
| `audit` | Run an audit (`--mode gate\|review\|all`, `--ci`, `--json`, `--target`, `--all`, `--env`, `--routes`, `--changed`, `--update-baseline`) |
| `install` | Download the Playwright browser |
| `login` / `logout` | Manage model provider credentials |
| `models` | List reachable models, recommended first |
| `explain <rule>` | Describe a rule |
| `ignore <fingerprint>` | Suppress one finding in `rules.yaml` |
| `baseline update` | Refresh `.gribble/baseline/` |
| `version` | Print the version |

Exit codes: `0` passed, `1` gate failed, `2` configuration or auth error, `3` unexpected crash.

Full reference: [gribble.dev/docs/cli](https://gribble.dev/docs/cli). The same pages ship inside this package under `docs/`.

## Programmatic use

```ts
import { run } from "gribble";

const exitCode = await run(["audit", "--mode", "gate", "--ci"]);
```

`run(argv, deps?)` accepts an optional `deps` object that replaces the audit runner, model runtime and other side effects, which is how the CLI's own tests avoid needing credentials.

## License

MIT
