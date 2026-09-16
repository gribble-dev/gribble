---
title: Auth
description: Logging in to the site under test, and logging in to your model provider. Two different problems.
order: 42
---

There are two unrelated authentication questions in Gribble, and mixing them up causes a lot of confusion:

1. **The site under test.** How does the audit reach pages behind a login?
2. **The model provider.** How does Gribble pay for the tokens review mode spends?

The first is configured per project in `gribble.yaml`. The second is a machine-level credential in `~/.gribble/`. They share nothing.

Part 2 also needs code that a gate-only install does not have: the provider catalog lives in `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent`, which Gribble declares as [optional peer dependencies](/docs/getting-started#the-review-runtime-is-optional). `gribble login`, `gribble logout` and `gribble models` all stop with the install command until they are present.

---

## Part 1: target-site auth

Most interesting pages are behind a login. Gribble handles this with **auth profiles** declared in `gribble.yaml`, referenced by name from flows.

**Secrets are never written in YAML.** A profile's `env` block maps a logical field name to an **environment variable name**; the value is read at the moment it is used and never passes through the config object.

```yaml
auth:
  profiles:
    user:
      type: flow
      flow: flows/auth/login.md
      env: { email: GRIBBLE_USER_EMAIL, password: GRIBBLE_USER_PASSWORD }
    admin:
      type: command
      command: pnpm exec ./scripts/admin-session.ts
```

### Profile types

#### `flow`

Drive a real login form once, using a [flow](/docs/flows) file.

```yaml
auth:
  profiles:
    user:
      type: flow
      flow: flows/auth/login.md
      env: { email: GRIBBLE_USER_EMAIL, password: GRIBBLE_USER_PASSWORD }
```

```md
---
name: login
---

Go to the sign-in page. Enter the test user's email and password from the
environment and submit. Confirm the account menu shows the user's email.
```

The most faithful option — it exercises the same path a real user takes — and the slowest. Best when your login is a plain form with no third-party identity provider in the middle.

#### `cookie`

Inject a session cookie directly.

```yaml
auth:
  profiles:
    user:
      type: cookie
      name: session
      env: { value: GRIBBLE_SESSION_COOKIE }
```

Fast and reliable. The catch is that somebody has to produce the cookie and rotate it before it expires, which makes this best for short-lived local runs and for staging environments that mint long-lived test sessions.

#### `header`

Attach a header to every request in the context.

```yaml
auth:
  profiles:
    api:
      type: header
      name: Authorization
      env: { value: GRIBBLE_TOKEN }
```

For token-based setups and for preview deployments protected by a shared header. `Authorization: Bearer <token>` works by putting the whole header value in the variable.

#### `command`

Run a script that prints a Playwright storage state JSON to stdout.

```yaml
auth:
  profiles:
    admin:
      type: command
      command: pnpm exec ./scripts/admin-session.ts
```

The escape hatch, and the right answer for SSO, for signed dev-only login endpoints, and for anything requiring a service account. Your script can call an internal API, mint a session, and print:

```json
{
  "cookies": [{ "name": "session", "value": "...", "domain": "localhost", "path": "/", "expires": -1, "httpOnly": true, "secure": false, "sameSite": "Lax" }],
  "origins": []
}
```

The command runs in your repository root with the audit's environment. Anything it writes to stderr is logged; only stdout is parsed.

### Using a profile

A flow claims a profile in its frontmatter:

```md
---
name: checkout
requires_auth: user
---
```

`requires_auth: true` uses the default profile when you have only one.

Routes can require a profile too — a route behind a login is audited in that profile's context, and the route list can be scoped per environment if the logged-out and logged-in route sets differ.

### The storage state cache

Logging in once per audit would be acceptable. Logging in once per route would not be.

Gribble caches the resulting browser storage state at:

```
.gribble/cache/auth/<profile>.json
```

Before a profile is used, the cache is checked: if it exists and still authenticates, it is reused; otherwise the login runs once and the result is written back.

`.gribble/cache/` is gitignored by the `.gribble/.gitignore` that `gribble init` generates. **Do not commit it.** It contains live session cookies, which is to say a working login to your staging environment.

In CI the cache starts empty every run, so each profile logs in exactly once per job. That is usually a few seconds and not worth caching across jobs — and if you do decide to cache it, understand that you are persisting a session token into your CI cache.

Clear it by hand when a login stops behaving:

```bash
rm -rf .gribble/cache/auth
```

### One browser context per profile

Each profile gets its own Playwright browser context, kept alive for the whole audit and shared across every tool call that needs it.

This matters for two reasons. Sessions do not leak between profiles — an `admin` flow cannot accidentally run as `user`, because they are separate cookie jars. And the audit does not re-authenticate constantly, because the context stays logged in from the first flow to the last route.

Multiple profiles means multiple simultaneous contexts. Two or three is normal; twenty means you are modelling something other than auth.

### No CAPTCHA, no 2FA bypass

Gribble will not solve CAPTCHAs and will not work around two-factor authentication. This is not a missing feature waiting to be built — defeating a bot check is exactly the behaviour those checks exist to stop, and an agent that does it is an agent you cannot trust on your own infrastructure either.

If login is gated by a CAPTCHA or a second factor, pick one:

- **Disable the check in staging.** The usual answer. Most teams already do this for their E2E suite.
- **Add a dev-only login endpoint** that mints a session for a known test user, and use a `command` profile to call it. Gate it behind an environment flag that is off in production.
- **Use a `cookie` or `header` profile** with a session produced out of band.
- **Use a test account exempted from the check**, where your identity provider supports it.

Never audit production with real user credentials. `allowed_origins` exists partly to make that hard to do by accident.

### Redaction

pi session files record every tool call with its arguments — which means a `fill` step on a password field would write your password to disk in plain text, and a report attachment could carry it further.

Gribble redacts. Every value of every environment variable named in an auth profile is collected before the run, and both the `tool_call` and `tool_result` hooks replace any occurrence of those values with `***` before anything is written to a session file, a log line, a report or a PR comment. Replay steps that fill secret fields are marked `secret: true` and store no value.

Redaction is string replacement on known secrets. It is thorough for the credentials you declared and it cannot help with a secret you never told Gribble about. So:

- Declare every credential through `auth.profiles.*.env`. A password typed directly into a flow body is not redacted, because Gribble has no way to know it is a password. It is also committed to git, which is the bigger problem.
- Treat `.gribble/sessions/` and `.gribble/runs/` as sensitive anyway. They are gitignored by default. Before attaching a run directory to a public issue, look at it.
- Use dedicated test accounts with no real data and no production access.

---

## Part 2: model provider auth

Review mode needs a model. Gate mode does not — if you have no credentials at all, `gribble audit --mode gate` still works completely.

Gribble is **bring your own key**. There is no Gribble account, no Gribble server and no proxy. You authenticate directly with a provider and the tokens are billed to you.

### `gribble login`

```bash
gribble login                        # pick from available providers
gribble login <provider>             # OAuth flow, or prompt for an API key
gribble login <provider> --api-key "$MY_KEY"
gribble logout <provider>
```

Credentials go to `~/.gribble/auth.json`. Gribble does not implement OAuth or key storage itself — it uses pi's `ModelRuntime` with the paths pointed at its own directory.

An OAuth login opens the provider's sign-in page in your browser and waits for the redirect back to `localhost`. The URL is printed too: if the browser is on another machine (SSH, a container), open it there and paste the final redirect URL into the prompt.

### `~/.gribble/`

```
~/.gribble/
  settings.json      user-level settings: default provider and model
  auth.json          API keys and OAuth tokens
  models.json        model catalogue with pricing
  models-store.json  catalogue cache
```

`GRIBBLE_HOME` overrides the location, which is useful for sandboxes and for keeping work and personal credentials apart.

This directory is **never** inside your repository. Project-level `.gribble/` holds settings, rules and baselines; credentials live in your home directory and only there.

### `reusePiAuth`

Already a pi user? Skip the second login.

```yaml
# .gribble/gribble.yaml
reusePiAuth: true
```

Gribble then reads credentials and the model catalogue from `~/.pi/agent/` instead of `~/.gribble/`. Only the credential location changes — the system prompt, tools and guardrails are still Gribble's.

### Resolution order

Which model runs:

1. `model` in `gribble.yaml` — committed, team-wide, reproducible.
2. `defaultProvider` / `defaultModel` in `~/.gribble/settings.json`.
3. The first model with valid credentials, with a warning.

Which credential is used, for a given provider:

1. A runtime override.
2. `auth.json` (API key or OAuth token).
3. The provider's standard environment variable — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY` and so on.
4. Custom provider configuration.

When the project's configured provider has no credential on this machine, Gribble fails with exit code `2` and a precise message:

```
No credentials for provider "<provider>", which .gribble/gribble.yaml requires.
Run: gribble login <provider>
```

### Choosing a model

```bash
gribble models
```

Lists everything your credentials can reach, **recommended models first**. The recommended set favours reliable tool calling, no need for vision (the agent reads structured page snapshots, not screenshots), and a price you can afford on every pull request.

Gribble hardcodes no model name anywhere in its code or documentation. The recommendation table lives in one file in the source and is refreshed each release, because any specific recommendation would be stale within months.

The `model` field uses pi's syntax and supports a thinking level:

```yaml
model: <provider>/<model>
model: <provider>/<model>:<thinking-level>
```

Every audit prints its token usage and cost at the end, from pi's pricing table, and the same numbers are in `report.budget`.

### CI uses API keys

In CI, put an API key in a repository secret and expose it as the provider's environment variable:

```yaml
- uses: gribble-dev/action@v1
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

No `gribble login` step, no interactive prompt, no credential file.

### Subscription OAuth must not go into CI

Some providers let you sign in with a consumer subscription instead of an API key. That is a fine way to work locally. **It must not be moved into CI.**

- It is a **personal** login. The tokens CI spends are billed to and rate-limited against one human being, and every failure becomes that person's problem.
- Provider terms generally cover interactive personal use, not automated shared infrastructure.
- OAuth tokens refresh and expire on a cadence designed for an interactive session, so a CI job will break at an unpredictable time, usually during a release.
- Copying the credential into a shared secret store hands your whole personal account to anyone who can read repository secrets or open a pull request that prints environment variables.

Use an API key in CI. If the cost of one is the blocker, run `--mode gate` in CI, which needs no model at all — and no model runtime, so the job installs neither a provider SDK nor a credential chain — and run review locally where your subscription belongs.

### If you genuinely cannot use a model in CI

```yaml
- uses: gribble-dev/action@v1
  with:
    mode: gate
```

Deterministic checks, flow replay and all three regression rules still run. You lose the AI review comments and keep the merge-blocking half — which, given that review can never block a merge anyway, is a smaller loss than it sounds.
