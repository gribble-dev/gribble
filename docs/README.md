# Gribble documentation source

This folder is the source of truth for Gribble's user documentation. It is used three ways:

1. **Rendered at [gribble.dev/docs](https://gribble.dev/docs)** by `apps/website` (SvelteKit + mdsvex). Each page is also served as raw Markdown by appending `.md` to its URL, and feeds `/llms.txt` and `/llms-full.txt`.
2. **Shipped inside the `gribble` npm package**, so it is readable offline at `node_modules/gribble/docs/` — which is where the coding-agent skill points agents first, and where the documentation matches the installed version rather than whatever is live.
3. **Read directly on GitHub** by anyone browsing the repository.

## Conventions

- Every page starts with frontmatter: `title`, `description`, `order`.
- `order` controls sidebar position: index `0`, getting started `10`, agent setup guide `11`, working with your agent (`skills.md`) `12`, concepts `20–29`, configuration `30–39`, flows `40`, guidelines `41`, auth `42`, GitHub CI `50`, GitLab CI `51`, monorepos `52`, CLI `60`, report format `61`, FAQ `90`.
- Headings start at `##`. The site renders `title` as the `h1`.
- Standard GitHub-flavored Markdown. Code fences are always tagged (`bash`, `yaml`, `md`, `json`, `ts`, `prompt`).
- **Agent first.** Wherever a page shows how to install, configure or use Gribble, lead with what the reader can ask their coding agent, then give the manual commands or YAML. Reference tables and field definitions stay as they are.
- A `prompt` fence holds text the reader pastes to their coding agent. The website renders it as an "Ask your agent" card with a copy button; GitHub shows a plain code block. Write it in English, imperative and concrete, one request per block, usually one to three sentences, naming real routes and journeys the way a user would. No Markdown and no shell commands inside, and never have it ask for something Gribble cannot do, or for a step the docs reserve for a person, such as running `gribble login` or setting a secret. The card is labelled, so no "Ask your agent:" lead-in is needed.

  ````md
  ```prompt
  Add a Gribble flow for the password reset journey: a user requests a reset link, opens it, sets a new password and lands signed in.
  ```
  ````
- Internal links are site-absolute paths without a file extension: `/docs/flows`, `/docs/concepts/baseline`.
- English only, like everything else in this repository. Tone follows `CONTRIBUTING.md`: light in the prose, dry and precise wherever a finding, an error or a field definition is being described.
- No hardcoded model names. Use `<provider>/<model>` placeholders; the recommendation table lives in `packages/core/src/models/recommended.ts`.

This file is not part of the rendered site.

## Generated files

`configuration/rules-reference.md` is **generated** — do not edit it by hand. It is produced from the rule registry in `packages/core/src/rules/` so that the rule list, option schemas, preset severities, examples and fix hints can never drift from the code.

```bash
pnpm docs:rules
```

The same registry metadata drives `gribble explain <rule>` and the `https://gribble.dev/rules/<id>` links attached to every finding.
