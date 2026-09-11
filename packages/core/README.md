# @gribble/core

The engine behind the `gribble` CLI and the GitHub Action: configuration and flow parsing, the rule
registry, report types and formatters, baseline diffing, prompt builders, and (phase 2) the pi-based
audit harness with its browser, check and gate tool packs.

```ts
import { loadProject, resolveRules, summarizeReport, toMarkdownSummary } from "@gribble/core";
```

Most users never import this package directly; install [`gribble`](https://www.npmjs.com/package/gribble)
instead. Documentation lives at https://gribble.dev/docs.

## Layout

| Folder | What it holds |
| --- | --- |
| `src/config` | TypeBox schemas for `gribble.yaml` and `rules.yaml`, parsing, `${VAR}` interpolation, environments, rule cascade |
| `src/rules` | Rule registry (ids, options, presets, fix hints), `explainRule`, docs renderer |
| `src/report` | Report and Finding schemas, fingerprints, dedupe and sort, Markdown/SARIF/JUnit output |
| `src/baseline` | Read, write and diff `.gribble/baseline/` |
| `src/flows` | `flows/*.md` frontmatter parsing and `*.replay.json` sidecars |
| `src/prompt` | System and audit prompt builders |
| `src/project` | Project discovery, monorepo cascade, `gribble init` templates |
| `src/models` | Recommended model table and agent directory resolution |
| `src/util` | Hashing, URL and glob helpers |

`pnpm docs:rules` regenerates `docs/configuration/rules-reference.md` from the registry.
