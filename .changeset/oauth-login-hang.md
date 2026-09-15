---
"gribble": patch
---

`gribble login` (and the login step of `gribble init`) no longer hangs after a successful OAuth sign-in. pi races its "paste the authorization code" prompt against the localhost callback and aborts the prompt once the browser redirect wins; the CLI ignored that abort, so the prompt kept stdin open and the process never exited even though the credentials were already stored. The auth URL is also printed as a plain log line instead of a boxed note, so a long URL survives copy and paste out of the terminal.

`gribble login` now opens the OAuth sign-in page in the browser on an interactive terminal, the way pi's own CLI does. The URL is still printed for the remote-machine case.
