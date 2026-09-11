# @gribble/skills

The Gribble skill for coding agents, plus the installer `gribble init` uses to put it in a repository.

The skill itself is a single file, `skills/gribble/SKILL.md`, in the [Agent Skills](https://gribble.dev/docs/skills) format. It has three sections:

1. **Fix findings** — read `.gribble/runs/latest.json`, work in severity order, fix, verify with `gribble audit --mode gate`.
2. **Write flows** — the format and frontmatter of `.gribble/flows/<name>.md`, and what the generated `<name>.replay.json` sidecar is for.
3. **Change rules and guidelines** — what belongs in `rules.yaml`, `gribble.yaml` and `guidelines.md`.

## Install

```bash
pnpm add -D @gribble/skills
```

Most people never install this directly: `gribble init` detects the agents in the repository and offers to write the skill, and `gribble init --update-skills` refreshes it.

## Usage

```ts
import {
	AGENT_LABELS,
	SKILL_VERSION,
	detectAgents,
	installSkill,
	installedSkillVersion,
	skillSource,
	skillTargetPath,
} from "@gribble/skills";

const kinds = await detectAgents(process.cwd());
// ["agents", "claude"]

for (const kind of kinds) console.log(AGENT_LABELS[kind]);
// Agent Skills (.agents/skills, used by pi and others)
// Claude Code (.claude/skills)

const results = await installSkill(process.cwd(), kinds);
// [{ kind: "agents", path: "<repo>/.agents/skills/gribble/SKILL.md", status: "installed" }, ...]
```

## API

| export | description |
| --- | --- |
| `SKILL_VERSION: string` | version of the shipped SKILL.md; equals the package version |
| `SKILL_NAME: string` | `"gribble"` |
| `skillSource(): Promise<string>` | the bundled SKILL.md, resolved relative to this module so it works from `dist/` |
| `AgentKind` | `"agents" \| "claude" \| "cursor" \| "pi"` |
| `AGENT_KINDS: readonly AgentKind[]` | every kind, in presentation order |
| `AGENT_LABELS: Record<AgentKind, string>` | labels for `gribble init` prompts |
| `detectAgents(repoRoot)` | `.claude/` → claude, `.pi/` → pi, `.cursor/` → cursor, `AGENTS.md` or `.agents/` → agents |
| `skillTargetPath(repoRoot, kind)` | agents and pi → `.agents/skills/gribble/SKILL.md`, claude → `.claude/…`, cursor → `.cursor/…` |
| `installSkill(repoRoot, kinds, { force })` | writes the file; returns `{ kind, path, status }[]` |
| `installedSkillVersion(path)` | the `version` in an installed SKILL.md's frontmatter, or `undefined` |
| `parseFrontmatterVersion(text)` | the same parse, on text you already have |

### Install statuses

| situation | status | written |
| --- | --- | --- |
| no file at the target path | `installed` | yes |
| file is byte-identical to the shipped skill | `unchanged` | no |
| file differs and records a different version (or `force: true`) | `updated` | yes |
| file differs but records the current version | `unchanged` | no — pass `force: true` to overwrite local edits |

`agents` and `pi` resolve to the same path; when both are requested, the second reports the state of the file the first one wrote.

## Development

```bash
pnpm --filter @gribble/skills build
pnpm --filter @gribble/skills typecheck
pnpm --filter @gribble/skills test
```

The `skills/` folder is not bundled — it ships verbatim through the package's `files` field, so editing `skills/gribble/SKILL.md` needs no rebuild. When bumping the package version, bump `SKILL_VERSION` and the SKILL.md frontmatter `metadata.version` with it; a test fails if they drift.
