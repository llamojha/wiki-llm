# Built-in auth gate (OIDC — Keycloak / Cognito)

> **Status**: DESIGN (plan 024). Deliverable spec; implementation is a
> follow-up plan (a **security boundary — high-care**). Default behavior is
> unchanged: `AUTH_MODE` unset ⇒ exactly today's open portal, e2e-safe.
>
> **Library status re-verify** before implementing (do not trust training-data
> versions): Auth.js (next-auth v5) Next 16 middleware compat, `openid-client`,
> and `jose` current majors.

## Why

The portal has **no authentication** — deliberate for the single-user MVP.
Today's answer is "put something in front of it": the k8s guide ships a
commented oauth2-proxy `auth-url` stub (`infra/k8s/ingress.yaml`); the Fargate
guides point at ALB `authenticate-oidc` / Cognito. That serves only people
running ingress controllers or ALBs. The most common self-host shape —
`docker run` on a VPS, or the compose stack on a home server — has **no auth
story at all**. The maintainer wants first-class Keycloak *and* Cognito gates;
both are OIDC providers, so the deliverable is **one provider-agnostic OIDC
gate, off by default**, verified against both. It answers *"may this person
enter the portal at all?"* — not *"who among many users is this?"* (that's
Phase 6 identity).

## What exists to build on

- **No auth layer anywhere in `web/`**: no `middleware.ts`, no session/cookie
  handling, no login route. Every handler and page is reachable by anyone who
  reaches the port.
- **"Gate both layers" precedent.** Feature flags gate the UI entry point *and*
  404 the route handler (`flagGuard`; CLAUDE.md: "hiding the button alone is not
  control"). An auth gate must do the same: middleware redirect for pages, 401
  guard around route handlers — one without the other is not a gate.
- **Single-user identity today**: `NEXT_PUBLIC_VAULT_USER_ID` names *the* user;
  no user table. The gate needs authentication + a **binary** authorization
  ("is this principal allowed in?"), not account management.
- **Unauthenticated-by-design surfaces to exempt**:
  - Docker `HEALTHCHECK` / k8s probes / ALB health checks. Gating them bricks
    every deploy target → a dedicated unauthenticated **`/api/health`**
    (recommended over exempting `/api/vaults`, which leaks vault names).
  - Phase 9 (`specs/personal-persona-agent.md`) adds deliberately public
    `GET /p/[slug]` + `POST /api/p/[slug]/chat` → the exemption mechanism must
    match **path prefixes**, not just fixed paths.
- **`NEXT_BASE_PATH`** is a build-time `basePath` — OIDC redirect/callback URLs
  and cookie paths must compose with it.
- **Test reality**: Playwright runs flags-on :3030 / flags-off :3031 with
  `MOCK_S3=1`. Any auth default other than **off** breaks the whole suite —
  `AUTH_MODE=none` is load-bearing.

## 1. Integration seam

| Option | Verdict |
|---|---|
| (1) External gate only, documented better (oauth2-proxy, ALB OIDC) | zero code, but leaves the `docker run` user with nothing and can't tell health-check traffic from humans |
| (2) Built-in OIDC in the app (middleware + route-handler session check) | owns the whole flow; adds crypto/session code we must get right |
| (3) **Both** | **recommended** |

**Recommendation: (3).** Built-in `AUTH_MODE=oidc` is the first-class path for
self-hosters; external gates stay documented and supported via a **trust
contract**: honor `X-Forwarded-User` **only** when `AUTH_MODE=proxy` **and** a
shared-secret header matches — so a misconfigured/replaced proxy can't spoof
identity.

**Library choice.** Evaluate at implementation time:

| Candidate | For | Against |
|---|---|---|
| **Auth.js (next-auth v5)** | batteries-included OIDC, Next-native | heavier dep surface for a public repo; v5 + Next 16 middleware compat must be verified |
| **`openid-client` + `jose` encrypted cookie** | minimal, transparent, no framework lock-in | we hand-roll the session/callback (more code to get right) |
| **`jose`-only minimal session** | smallest surface | most to build (discovery, PKCE by hand) |

**Lean `openid-client` + `jose`** for a public, lock-in-averse repo unless the
spike shows Auth.js v5 middleware integration is clean under `basePath`.
Decision criteria: dependency surface, Next 16 middleware compat, no hosted-
service lock-in.

## 2. Gate semantics

- **Config surface** (all secrets env-only; documented in
  `docs/configuration.md` shape):
  `AUTH_MODE=none|oidc|proxy` (default **`none`** — today's behavior, e2e-safe),
  `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `AUTH_SESSION_SECRET`,
  and a **deny-by-default allowlist** `AUTH_ALLOWED_SUBJECTS` /
  `AUTH_ALLOWED_EMAILS` — *an IdP full of employees must not all get in just by
  authenticating.*
- **Session shape**: encrypted, `HttpOnly`, `SameSite=Lax`, `Secure` cookie
  scoped under `NEXT_BASE_PATH`; a TTL + silent-refresh story; a logout route.
  **No server-side session store** (nothing added to the stack) — the tradeoff
  is that **revocation = cookie expiry**; state it explicitly, keep TTLs modest.
- **Exemption list** (prefix-aware): `/api/health` (new, minimal), Phase 9's
  `/p/*` + `/api/p/*`, the OIDC callback route(s), static assets. **Everything
  else — including every `/api/*` handler — requires a session.** Enumerate
  from the 19-handler `flagGuard` inventory so nothing is accidentally exempt.
- **Both-layers enforcement**: middleware alone is not the guard (handlers are
  directly reachable). Define a shared `requireSession()` helper handlers call,
  mirroring `flagGuard`'s placement. Ordering: **auth before flag** — return
  401 before 404, so an unauthenticated caller can't probe *which features
  exist*.
- **Keycloak + Cognito acceptance recipes** (one page each in the impl plan):
  Keycloak realm/client (confidential client, redirect URI with `basePath`);
  Cognito user-pool app-client — **verify in the spike**: Cognito's logout
  endpoint is non-standard (`/logout?client_id=…&logout_uri=…`), and
  issuer/JWKS URLs are per-pool (`https://cognito-idp.<region>.amazonaws.com/<poolId>`).

## 3. Interaction table

| vs | Behavior |
|---|---|
| **Feature flags** | auth first (401) then flag (404) — don't leak feature existence to anonymous callers |
| **Bedrock agent** | server-side, unaffected by the human gate |
| **Plan 023 capability tokens** | a valid token bypasses the human gate on agentic endpoints (§ that spec's precedence rule); tokens never accepted on browser routes |
| **Phase 9 public routes** | `/p/*` + `/api/p/*` are exempt prefixes |
| **Phase 6 identity** | session claims (`sub`, `email`) become the user identity — the allowlist section is written to be **deleted** when real multi-user identity lands |
| **`MOCK_S3` / e2e** | `AUTH_MODE=none` forever in CI, **plus one e2e smoke** booting `AUTH_MODE=oidc` against a mock issuer asserting 401/redirect — the regression guard that "the gate actually gates" |

## 4. Roadmap

- **v1**: `AUTH_MODE=oidc` + deny-by-default allowlist + `/api/health`
  exemption + Keycloak/Cognito docs recipes + the one auth-on e2e smoke.
- **v2**: `AUTH_MODE=proxy` trust mode (shared-secret `X-Forwarded-User`) +
  Phase 6 claims→identity mapping.
- **Non-goals**: multi-user roles (Phase 6), SAML/LDAP/social, agent auth
  (plan 023), rate-limiting the public persona routes (Phase 9 owns that).

## 5. Open questions

1. **Auth.js vs minimal `jose`.** Recommend minimal `openid-client`+`jose` for
   a public repo; revisit if the spike shows Auth.js v5 is clean under `basePath`.
2. **Optional Keycloak in `docker-compose.yml`** for local testing? Recommend:
   yes, commented-out/opt-in service, so self-hosters can try the gate without
   standing up an IdP by hand.
3. **Session TTL default.** Recommend 12h with silent refresh; revocation is
   expiry-bound (no store), so not too long.
4. **`requireSession()` wrapping — per-handler call vs a `withGuards()` HOF.**
   If the spike shows ~15 handlers each need boilerplate, surface a
   `withGuards(flag?, auth?)` wrapper as a refactor **precondition** rather than
   scattering calls.
5. **Health endpoint scope** — `/api/health` returns only `{ ok: true }` (no
   vault names, no version leak)? Recommend yes, minimal.

## STOP conditions honored

- If Next 16 middleware / the chosen library can't do the code-flow callback
  under a non-root `basePath`: fall back to a **root callback with the cookie
  scoped to `basePath`**, documented as a limitation — don't force it.
- If route-handler wrapping needs touching all ~15 handlers with no shared seam:
  that's the `withGuards()` refactor precondition above, not baked-in boilerplate.

## Test matrix (for the implementation plan)

Unauthenticated page → redirect; unauthenticated API → **401 JSON** (not a
redirect); `/api/health` → 200 with no cookie; allowlist miss after successful
IdP login → **403**; flag-off + auth-on ordering (401 before 404); `/p/*`
reachable with no session; cookie flags (`HttpOnly`/`Secure`/`SameSite=Lax`)
asserted; callback composes with `NEXT_BASE_PATH`.
