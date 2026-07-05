# Plan 029: Implement the built-in OIDC auth gate

> **Executor instructions**: This is the **implementation** follow-up to the
> design in [`specs/auth-gate.md`](../specs/auth-gate.md) (plan 024). Read that
> spec **in full** first — its §1–§5, interaction table, STOP conditions, and
> test matrix are the contract; this plan sequences the build. This is a
> **security boundary**: 002/005-level care. Update `plans/README.md` when done.
>
> **Drift check (run first)**:
> `git log --oneline -1 -- web/lib/flags.ts specs/auth-gate.md` and confirm
> (a) `specs/auth-gate.md` still exists and matches the design summarized below,
> (b) there is still **no** `web/middleware.ts` and no session handling in
> `web/` (this plan creates the first), and (c) the `flagGuard` inventory in
> `web/lib/flags.ts` still enumerates the gated route handlers. If an auth layer
> already exists, STOP — this plan has been superseded.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH — this is an authentication boundary. A wrong default, a
  missed handler, or a spoofable trust header is a real vulnerability, not a
  bug. The load-bearing invariant is **`AUTH_MODE` unset ⇒ exactly today's open
  portal** (the entire e2e suite depends on it).
- **Depends on**: plan 024 (design spec `specs/auth-gate.md`) — DONE.
- **Category**: security / infrastructure
- **Planned at**: commit `c6e31f7` (preview: folders mode + HTML docs), 2026-07-05

## Why this matters

The portal ships with **no authentication** — fine for the single-user MVP, but
the only current answer for real deployments is "put something in front of it"
(oauth2-proxy, ALB `authenticate-oidc`, VPN). That serves only ingress/ALB
operators; the most common self-host shape (`docker run` on a VPS, the compose
stack on a home server) has **no auth story at all**. The maintainer wants
first-class **Keycloak and Cognito** gates. Both are OIDC providers, so the
deliverable is **one provider-agnostic OIDC gate, off by default**, verified
against both. It answers *"may this person enter the portal at all?"* — a binary
gate, **not** multi-user identity (that is Phase 6).

## Current state (what 024 leaves in place)

- **No auth anywhere in `web/`**: no `middleware.ts`, no session/cookie code, no
  login/callback/logout routes. Every page and every `/api/*` handler is
  reachable by anyone who can reach the port.
- **"Gate both layers" precedent** (`flagGuard`, CLAUDE.md: "hiding the button
  alone is not control"): flags 404 the route handler *and* hide the UI. The
  auth gate must mirror this — middleware redirect for pages **and** a 401 guard
  inside handlers. One without the other is not a gate.
- **`NEXT_BASE_PATH`** is a build-time `basePath`; OIDC redirect/callback URLs
  and the session cookie path must compose with it.
- **Test reality**: Playwright boots flags-on :3030 / flags-off :3031 with
  `MOCK_S3=1`. Any default other than `AUTH_MODE=none` breaks the suite.

## What to build (v1 — spec §4)

1. **Library spike + decision (do this first, timeboxed).** Re-verify current
   majors (do not trust training data): Auth.js (next-auth v5) Next 16
   middleware compat under `basePath`, `openid-client`, `jose`. Decide per spec
   §1/§5.1: **lean `openid-client` + `jose` encrypted cookie** unless the spike
   shows Auth.js v5 middleware is clean under a non-root `basePath`. Record the
   decision + versions in the PR.
2. **Config surface** (env-only; document the shape in `docs/configuration.md`):
   `AUTH_MODE=none|oidc|proxy` (default **`none`**), `OIDC_ISSUER`,
   `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `AUTH_SESSION_SECRET`, and a
   **deny-by-default allowlist** `AUTH_ALLOWED_SUBJECTS` / `AUTH_ALLOWED_EMAILS`
   (an IdP full of employees must not all get in just by authenticating).
3. **OIDC code flow** (v1 = `oidc` mode only): discovery, PKCE, login →
   callback → encrypted session cookie, logout route. Cookie: encrypted,
   `HttpOnly`, `SameSite=Lax`, `Secure`, scoped under `NEXT_BASE_PATH`. **No
   server-side session store** — revocation = cookie expiry; keep TTL modest
   (recommend 12h + silent refresh; §5.3).
4. **Both-layers enforcement.**
   - `web/middleware.ts`: redirect unauthenticated **page** requests to login.
   - Shared **`requireSession()`** helper that handlers call (mirror
     `flagGuard`'s placement). Ordering is **auth before flag** — return **401
     before 404** so anonymous callers can't probe which features exist.
   - If the spike shows ~15 handlers each need boilerplate, surface a
     **`withGuards(flag?, auth?)`** wrapper as a refactor *precondition* (§5.4),
     not scattered calls.
5. **Exemption list (prefix-aware, not fixed paths):** a new minimal
   **`GET /api/health` → `{ ok: true }`** (no vault names / version leak), the
   OIDC callback route(s), static assets, and Phase 9's `/p/*` + `/api/p/*`
   public prefixes. **Everything else — including every `/api/*` handler —
   requires a session.** Enumerate against the `flagGuard` handler inventory so
   nothing is accidentally exempt.
6. **Acceptance recipes** (one page each): Keycloak realm/confidential client
   (redirect URI with `basePath`); Cognito user-pool app-client — **verify in
   the spike**: Cognito's logout endpoint is non-standard
   (`/logout?client_id=…&logout_uri=…`) and issuer/JWKS are per-pool
   (`https://cognito-idp.<region>.amazonaws.com/<poolId>`).
7. **Optional opt-in Keycloak** (commented-out) in `infra/docker-compose.yml`
   so self-hosters can try the gate without hand-standing an IdP (§5.2).
8. **Tests** — the full §"Test matrix": unauthenticated page → redirect;
   unauthenticated API → **401 JSON** (not a redirect); `/api/health` → 200 with
   no cookie; allowlist miss after successful IdP login → **403**; flag-off +
   auth-on ordering (**401 before 404**); `/p/*` reachable with no session;
   cookie flags asserted; callback composes with `NEXT_BASE_PATH`. Plus the
   **one auth-on e2e smoke** booting `AUTH_MODE=oidc` against a mock issuer
   (the regression guard that "the gate actually gates"); the existing suites
   stay `AUTH_MODE=none`.

## Out of scope (v2 / non-goals — spec §4)

- **v2**: `AUTH_MODE=proxy` trust mode (honor `X-Forwarded-User` **only** when
  `AUTH_MODE=proxy` **and** a shared-secret header matches); Phase 6
  claims→identity mapping.
- **Non-goals**: multi-user roles (Phase 6), SAML/LDAP/social login, agent auth
  (plan 023 capability tokens — a valid token bypasses the human gate on
  agentic endpoints and is never accepted on browser routes), rate-limiting the
  public persona routes (Phase 9).

## STOP conditions

- **If Next 16 middleware / the chosen library can't do the code-flow callback
  under a non-root `basePath`**: fall back to a **root callback with the cookie
  scoped to `basePath`**, documented as a limitation — do not force it.
- **If route-handler wrapping would touch all ~15 handlers with no shared
  seam**: that's the `withGuards()` refactor precondition (§5.4/task 4), not
  baked-in per-handler boilerplate.
- **STOP before changing the `AUTH_MODE=none` default or any e2e server env** —
  `none` is load-bearing; the auth-on path gets its own dedicated smoke server.
- **STOP if the allowlist is not deny-by-default** — "authenticated" must never
  imply "allowed"; an empty/unset allowlist in `oidc` mode denies everyone
  (fail closed) rather than admitting the whole IdP.

## Verification

- `pnpm typecheck && pnpm test:unit && VAULT_BUCKET=build-placeholder pnpm build && pnpm test:e2e && pnpm --filter @vaultmark/web lint`.
- Existing e2e suites stay green with `AUTH_MODE` unset (proves the default is
  invisible). The new auth-on smoke asserts redirect (page) / 401 (API) /
  `/api/health` 200 / allowlist-miss 403 / 401-before-404 ordering against a
  mock issuer.
- Manual/spike acceptance against a real Keycloak realm and a real Cognito user
  pool, per the recipes.
