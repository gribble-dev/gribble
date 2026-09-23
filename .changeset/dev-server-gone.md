---
"@gribble/core": minor
"gribble": minor
"@gribble/action": patch
---

`gribble audit` no longer hangs when the dev server dies mid-crawl (#38). Stopping `target.start` used to signal only the shell Gribble spawned, and returned early once that shell had exited; a server it launched (a package manager wrapper, `a && b`, a runtime supervisor) survived, kept Gribble's stdout/stderr pipes open and kept the CLI alive after the audit. The whole process group is now signalled, waited on and killed if it lingers, and the CLI exits explicitly once its output is flushed instead of waiting for the event loop to drain. Closing pages and the browser is bounded as well.

The audit also stops as soon as the target is gone: when the `target.start` process exits and `target.url` no longer answers, or when `target.maxConnectionFailures` (default `3`, `0` disables) page loads in a row fail with a connection error and the base URL is confirmed dead. `runAudit` rejects with the new `TargetGoneError` and writes neither a report nor a baseline, since every later route would read as a page error and every baseline finding on it as fixed. The CLI prints `error: the dev server is gone: …` followed by the server's last 40 lines of output and exits with the new code `4`; `DevServerError` carries the same `output` tail when the server never comes up. `DevServer` gains `unexpectedExit` and `outputTail()`, and the action names exit code `4` in its failure message.
