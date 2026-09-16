---
"@gribble/core": patch
---

Route discovery now handles optional and escaped syntax consistently across frameworks, instead of
leaking it into route ids and baseline keys.

- **Next.js and Nuxt page file names are cleaned like directories.** `pages/docs/[[...slug]].tsx`
  was discovered as `/docs/[[...slug]]`, double brackets and all, because only the directory part
  of the path went through normalization. Nuxt 2 `_id` directories were dropped as private folders
  for the same reason.
- **Remix splats survive.** `blog.$.tsx` produced `/blog/[..splat]` — the literal-escape rule ate a
  dot from the splat it had just generated — which then compiled to a single required segment and
  matched `/blog/a` but not `/blog/a/b`.
- **Next.js intercepting routes are skipped.** `app/feed/(.)photo/[id]/page.tsx` was discovered as
  `/feed/(.)photo/[id]`, a route whose parentheses can never match a real URL. It re-renders a
  route that exists elsewhere in the tree, so it is not a URL to audit.
- **Optional segments expand everywhere, not just in SvelteKit.** Next.js `[[...slug]]` and Remix
  `($lang)` now emit both the absent and present forms, so `/docs` and `/about` are discovered
  alongside `/docs/[...slug]` and `/[lang]/about`.
- **Rest parameters match zero segments.** `routePatternRegex("/docs/[...slug]")` now matches
  `/docs`, the way the frameworks route it.
