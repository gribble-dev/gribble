# Gribble documentation source

This folder is the source of truth for Gribble's user documentation. It is used three ways:

1. **Rendered at [gribble.dev/docs](https://gribble.dev/docs)** by `apps/website` (SvelteKit + mdsvex). Each page is also served as raw Markdown by appending `.md` to its URL, and feeds `/llms.txt` and `/llms-full.txt`.
2. **Shipped inside the `gribble` npm package**, so it is readable offline at `node_modules/gribble/docs/` — which is where the coding-agent skill points agents first, and where the documentation matches the installed version rather than whatever is live.
3. **Read directly on GitHub** by anyone browsing the repository.

## Conventions

- Every page starts with frontmatter: `title`, `description`, `order`.
- `order` controls sidebar position: index `0`, getting started `10`, concepts `20–29`, configuration `30–39`, flows `40`, guidelines `41`, auth `42`, GitHub CI `50`, GitLab CI `51`, monorepos `52`, skills `53`, CLI `60`, report format `61`, FAQ `90`.
- Headings start at `##`. The site renders `title` as the `h1`.
- Standard GitHub-flavored Markdown. Code fences are always tagged (`bash`, `yaml`, `md`, `json`, `ts`).
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
