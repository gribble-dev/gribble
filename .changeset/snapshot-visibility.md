---
"@gribble/core": patch
---

`ui/overlap`, `ui/text-clipped` and `a11y/touch-target` no longer measure elements nobody can see. The page snapshot now gates on `Element.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })` instead of a hand-rolled `display`/`visibility`/`opacity` trio, which is the only probe that catches the contents of a closed `<details>`: Chromium hides those through the `::details-content` pseudo-element, so the descendant's own computed `content-visibility` still reads `visible`. A locale switcher parked inside a collapsed `<details>` no longer reports a phantom overlap against whatever sits beneath it.

The visually-hidden idiom — a 1px box clipped with `clip: rect(0, 0, 0, 0)` or `clip-path: inset(50%)`, as Tailwind's `sr-only` and Bootstrap's `.visually-hidden` emit — is genuinely rendered, so it needs its own exemption: `ui/text-clipped` skips it before measuring and `a11y/touch-target` before comparing. A `<a href="#main" class="sr-only focus:not-sr-only">Skip to content</a>` skip link is no longer reported as a 1×1px target with clipped text, which is a relief, because `a11y/skip-link`'s fix hint asks for exactly that markup.

`ui/overlap` additionally skips any target whose centre is buried under a non-interactive overlay, and `ui/text-clipped` shares the same visibility helpers as the rest of the snapshot rather than re-checking `display` and `visibility` on its own.
