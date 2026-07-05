# Feature flags and the auth gate

## Feature flags

`web/lib/flags.ts` is the single source of truth for eight toggleable
features (`agent`, `upload`, `curate`, `reindex`, `editor`, `search`,
`star`, `publishing`), each controlled by its own `FEATURE_*` env var, read
once at module load.

Resolution per flag: if the env var is set, it wins — ON unless its value is
one of the falsy tokens (`off`/`false`/`0`/`no`/`disabled`). If the env var
is absent, the flag falls back to `DEFAULT_BY_FEATURE`: **`agent` defaults
ON, every other feature defaults OFF.** The stated default profile is "plain
Markdown + Bedrock ask-wiki agent, no ingest processing" — an operator has to
opt in to upload/curate/editor/etc., not opt out.

Every flag gates **two layers**, and the route guard is the one that
actually matters:
1. **UI** — `FLAGS` is computed server-side and passed as a prop into the
   client `AppShell`, which hides the corresponding entry points.
2. **Routes** — `flagGuard(name)` is called at the top of the matching route
   handler and short-circuits with a 404 (not 403 — a disabled feature looks
   like it doesn't exist rather than advertising a locked door) when the
   flag is off.

Document read paths (`GET /api/docs`, tree listing, raw content) are
deliberately **never** gated — the portal stays browsable with every
optional feature off.

`FEATURE_CURATE_AUTOSYNTH` is a related but separate opt-in toggle for the
curate Lambda's synthesis chaining — it's read directly from `process.env`
in `web/app/api/curate/start/route.ts`, not registered in `flags.ts`,
because it has no UI surface (see
[Curate pipeline](../workflows/curate-pipeline.md)).

## Auth gate

`web/lib/auth.ts` defines three modes via `AUTH_MODE` (default `none`):

- **`none`** — no gate; today's open portal. This is load-bearing: the
  entire e2e suite and every existing deployment depend on `none` being the
  default when `AUTH_MODE` is unset, so changing that default is a breaking
  change, not a config tweak.
- **`oidc`** — a built-in OIDC authorization-code flow
  (`web/lib/auth-oidc.ts`) plus an encrypted session cookie
  (`web/lib/auth-session.ts`). This is the self-host-first-class path (v1,
  shipped in `plans/029`).
- **`proxy`** — intended to trust an upstream gate's `X-Forwarded-User`
  header, gated by a shared secret (`AUTH_PROXY_SHARED_SECRET`). The config
  field exists (`authConfig()`), but as of this writing no route or
  middleware branches on `mode === 'proxy'` to actually enforce it — it's
  parsed, not yet wired to anything. Treat it as reserved, not shipped.

An unrecognized/misspelled `AUTH_MODE` value **fails open** to `none` — a
config typo must not accidentally lock everyone out of what was meant to be
an open portal. This is a deliberate asymmetry: the *mode selector* fails
open, but the *allowlist* inside `oidc` mode fails closed (see below). Don't
"fix" the mode selector to fail closed; that inverts an intentional design
choice.

### Deny-by-default allowlist

Authenticating via the IdP is not the same as being allowed in.
`isPrincipalAllowed()` checks the authenticated principal's `sub` against
`AUTH_ALLOWED_SUBJECTS` or `email` against `AUTH_ALLOWED_EMAILS`
(case-insensitive for email, exact for subject). **An empty/unset allowlist
admits no one** — if you configure `oidc` mode but forget both allowlist
vars, every authenticated user from the IdP is rejected, not admitted. This
is intentional: an IdP full of unrelated employees/tenants must not all get
portal access just because they can log in.

## Things to watch when editing

- Adding a new feature means updating `flags.ts` (`FeatureName`,
  `ENV_BY_FEATURE`, `DEFAULT_BY_FEATURE`) **and** calling `flagGuard` in the
  route handler — a flag with no route guard is not actually enforced, only
  cosmetically hidden in the UI.
- Container images bake the flag defaults in as `ENV` — `web/Dockerfile`
  must stay in sync with `flags.ts`'s `DEFAULT_BY_FEATURE`.
- Wiring `proxy` auth mode end-to-end (reading `X-Forwarded-User`, verifying
  the shared secret, and actually gating requests on it) is unfinished work,
  not a bug — don't assume it works today because the config field exists.

## Source references

- `web/lib/flags.ts` — flag definitions, resolution, `flagGuard`.
- `web/lib/auth.ts` — mode resolution, allowlist authorization.
- `web/lib/auth-guard.ts`, `auth-oidc.ts`, `auth-session.ts` — session/flow
  implementation.
- `docs/feature-flags.md`, `docs/configuration.md` — exhaustive env var and
  per-flag reference (UI surfaces, dependencies, off/on recipes).
- `specs/auth-gate.md`, `plans/029-implement-auth-gate-oidc.md`.
