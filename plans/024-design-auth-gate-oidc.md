# Plan 024: Design a built-in auth gate (OIDC — Keycloak / Cognito)

> **Executor instructions**: This is a **design/spike plan** — the deliverable
> is a written spec plus an optional local spike, NOT a shipped auth system.
> Follow the steps, honor STOP conditions, and update `plans/README.md` when
> done.
>
> **Drift check (run first)**: `git diff --stat f46e740..HEAD -- web/lib/flags.ts web/app/api/ web/Dockerfile docs/deploy/ infra/k8s/ingress.yaml specs/personal-persona-agent.md`
> On material drift in the flag/route layer or deploy docs, re-derive
> "Current state" before writing the spec.

## Status

- **Priority**: P2
- **Effort**: M (design; implementation follows as its own plan)
- **Risk**: LOW as a spec; the surface it designs is a security boundary —
  the implementation plan it produces is HIGH-care
- **Depends on**: none to write; cite plans/023 (the agentic-access gateway
  designs a *token* auth model — this spec designs the *human session* model;
  they must not contradict each other) and plan/009 (error hygiene the login
  flow inherits)
- **Category**: direction / design
- **Planned at**: commit `f46e740`, 2026-07-04

## Why this matters

The portal has **no authentication at all** — deliberate for the single-user
MVP, and today's answer is "put something in front of it": the k8s guide
points at oauth2-proxy (`infra/k8s/ingress.yaml:2-11` ships a commented
`auth-url` stub), the Fargate guides point at ALB `authenticate-oidc` /
Cognito listener rules (`docs/deploy/ecs-fargate.md:147`,
`docs/deploy/fargate-deployment.md:248`). That works only for people who run
ingress controllers or ALBs. The most common self-host shape — `docker run`
on a VPS, or the compose stack on a home server — has **no auth story at
all**, and the maintainer wants first-class support for Keycloak and Cognito
gates. Both are OIDC providers, so the real deliverable is **one
provider-agnostic OIDC gate, off by default**, verified against both — not
two vendor integrations. This lands *before* Phase 6 (which owns real
multi-user identity): the gate answers "may this person enter the portal at
all?", not "who is this user among many?".

## Current state (what exists to build on)

- **No auth layer anywhere in `web/`**: no `web/middleware.ts`, no session
  or cookie handling, no login route. Every route handler and page is
  reachable by anyone who can reach the port.
- **The "gate both layers" precedent**: feature flags gate the UI entry point
  *and* 404 the route handler via `flagGuard` (`web/lib/flags.ts`, CLAUDE.md
  "Hiding the button alone is not control"). An auth gate must follow the
  same discipline: middleware redirect for pages, 401 guard in/around route
  handlers — one without the other is not a gate.
- **Single-user identity today**: `NEXT_PUBLIC_VAULT_USER_ID` (build-arg,
  `web/Dockerfile:24`) names *the* user; there is no user table. The gate
  therefore needs authentication + a binary authorization ("is this
  principal allowed in?"), not account management.
- **Unauthenticated-by-design surfaces the gate must exempt**:
  - Docker `HEALTHCHECK` hits `GET /api/vaults` from inside the container
    (`web/Dockerfile:87`); k8s probes and ALB target-group health checks do
    the same class of thing. Gating health endpoints bricks every deploy
    target — the spec needs an explicit exemption list (recommend a
    dedicated unauthenticated `/api/health` rather than exempting
    `/api/vaults`, which leaks vault names).
  - Phase 9 (`specs/personal-persona-agent.md`) adds deliberately public
    routes: `GET /p/[slug]` and `POST /api/p/[slug]/chat`. The gate's
    exemption mechanism must cover path *prefixes*, not just fixed paths.
- **`NEXT_BASE_PATH`** is a build-time `basePath` (`web/next.config.ts`) —
  OIDC redirect/callback URLs and cookie paths must compose with it.
- **Test reality**: Playwright e2e runs two servers with `MOCK_S3=1`
  (flags-on :3030 / flags-off :3031); any auth default other than OFF breaks
  the whole suite. `AUTH_MODE` default `none` is load-bearing.
- **plans/023 overlap**: the agentic gateway authenticates *agents* with
  capability tokens minted by the operator. This spec authenticates *humans*
  with OIDC sessions. Both guard the same route handlers eventually — the
  spec must state the precedence rule (recommend: a valid capability token
  on the agentic endpoints bypasses the human session gate; everything else
  requires a session when `AUTH_MODE=oidc`).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Recon     | `grep -rn "flagGuard" web/app web/lib` | map every guarded handler |
| E2E       | `pnpm build && pnpm test:e2e` | green (no default change from any spike) |
| Spike IdP | `docker run -p 8080:8080 quay.io/keycloak/keycloak start-dev` | local Keycloak for the spike |

## Scope

**In scope**:
- `specs/auth-gate.md` (create — the deliverable)
- Optional local spike: OIDC code flow against a dev-mode Keycloak container,
  behind `AUTH_MODE` (default unset ⇒ `none`); spike code does not merge

**Out of scope**:
- Multi-user identity, roles, per-user authorization — Phase 6 owns that;
  this spec must state how the gate *upgrades into* Phase 6 identity
  (session claims become the user identity) without being rewritten.
- Agent/machine authentication — plans/023's domain; only the precedence
  rule is in scope here.
- SAML, LDAP, social-login matrices — OIDC only; Keycloak and Cognito are
  the two named acceptance targets.

## Git workflow

- Branch: `advisor/024-auth-gate-design`
- Deliverable commit: `specs/auth-gate.md` only.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Decide the integration seam (with a recommendation)

Compare, in a table + prose:

1. **External gate only, documented better** (status quo, more recipes):
   oauth2-proxy sidecar, ALB OIDC/Cognito. Zero code, but leaves the
   `docker run` user with nothing, and the app can't distinguish
   health-check traffic from humans.
2. **Built-in OIDC in the app** — Next.js middleware for page redirects +
   a session check wrapping route handlers (same double-layer shape as
   `flagGuard`). Owns the whole flow; adds crypto/session code we must get
   right.
3. **Both** (recommended shape to argue): built-in `AUTH_MODE=oidc` as the
   first-class path for self-hosters, external gates remain documented and
   supported — the spec defines a trust contract for them (e.g. honor
   `X-Forwarded-User` ONLY when `AUTH_MODE=proxy` and a shared secret
   header matches, so a misconfigured proxy can't spoof identity).

Library choice belongs in this step: evaluate Auth.js (next-auth v5) vs
`openid-client` + hand-rolled encrypted cookie vs a minimal
`jose`-based session. Decision criteria: dependency surface for a
public repo, Next.js 16 middleware compatibility, no lock-in to a hosted
service. Verify current library status during the spike — do not trust
training-data versions.

### Step 2: Specify the gate semantics

The spec must pin down, each with rationale:

- **Config surface**: `AUTH_MODE=none|oidc|proxy` (default `none` — current
  behavior, e2e-safe), `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`,
  `AUTH_SESSION_SECRET`, `AUTH_ALLOWED_SUBJECTS`/`AUTH_ALLOWED_EMAILS`
  (deny-by-default allowlist — an IdP full of employees must not all get in
  just by authenticating), documented in `docs/configuration.md` shape.
  All secrets env-only (repo rule: no deployment values in the repo).
- **Session shape**: encrypted, HTTP-only, `SameSite=Lax` cookie under
  `NEXT_BASE_PATH`; TTL + refresh story; logout route. No server-side
  session store (nothing to add to the stack), which means revocation =
  cookie expiry — state this tradeoff explicitly.
- **Exemption list**: `/api/health` (new, minimal, unauthenticated),
  Phase 9's `/p/*` + `/api/p/*` prefix, OIDC callback routes, static assets.
  Everything else — **including every `/api/*` handler** — requires a
  session. Enumerate the route inventory from the Step 1 recon so nothing is
  accidentally exempt.
- **Both-layers enforcement**: middleware alone is not the guard (route
  handlers are directly reachable); define the shared `requireSession()`
  helper handlers call, mirroring `flagGuard`'s placement, and whether it
  composes (`flagGuard` returns 404 before auth returns 401? — recommend
  auth first: don't leak which features exist to unauthenticated callers).
- **Keycloak + Cognito acceptance recipes**: one page each — realm/client
  setup for Keycloak, user-pool app-client for Cognito (note Cognito
  specifics worth verifying in the spike: its logout endpoint is
  non-standard, and issuer/JWKS URLs are per-pool). These become
  `docs/deploy/` additions in the implementation plan.

### Step 3: Interaction table

One row each — gate behavior versus: feature flags (guard ordering), the
Bedrock agent (server-side, unaffected), plans/023 capability tokens
(precedence rule), Phase 9 public routes (exempt prefix), Phase 6 identity
(claims → user mapping upgrade path), `MOCK_S3`/e2e (`AUTH_MODE=none`
forever in CI, plus ONE e2e smoke that boots `AUTH_MODE=oidc` against a
mock issuer and asserts a 401/redirect — that test is the regression guard
for "gate actually gates").

### Step 4: Optional spike (timebox: half a day)

Dev-mode Keycloak container + the recommended library: code flow end-to-end
locally, confirm (a) callback URL composes with `NEXT_BASE_PATH`, (b) route
handlers can share the session check without per-handler boilerplate
explosion, (c) the flags-off server still boots with `AUTH_MODE` unset.
Findings go in the spec's touch list.

### Step 5: Roadmap section

End the spec with the implementation cut: v1 = `AUTH_MODE=oidc` + allowlist +
health exemption + docs recipes for Keycloak/Cognito; v2 = `proxy` trust mode
+ Phase 6 claims mapping. ≤5 open questions with recommendations (candidates:
Auth.js vs minimal `jose`; whether `docker-compose.yml` grows an optional
Keycloak service for local testing; session TTL default).

## Test plan

Spec-stage: spike checklist only. The spec must define the implementation
plan's test matrix: unauthenticated page → redirect; unauthenticated API →
401 JSON (not a redirect); health path 200 with no cookie; allowlist miss →
403 after successful IdP login; flag-off + auth-on ordering; `/p/*` reachable
with no session; cookie flags (HttpOnly/Secure/SameSite) asserted.

## Done criteria

- [ ] `specs/auth-gate.md` with: seam decision + library choice (Step 1),
      gate semantics incl. config/exemptions/both-layers (Step 2),
      interaction table (Step 3), roadmap + ≤5 open questions (Step 5)
- [ ] Keycloak AND Cognito each have a concrete acceptance recipe sketch
- [ ] Default behavior unchanged: `AUTH_MODE` unset ⇒ exactly today's
      portal; full e2e green
- [ ] Precedence rule vs plans/023 tokens stated in both specs' terms
- [ ] `plans/README.md` status row updated (and the "No authentication"
      entry under *Findings considered and rejected* already points here)

## STOP conditions

- Next.js 16 middleware or the chosen library cannot implement the
  code-flow callback under a non-root `basePath` — document the limitation
  and propose the fallback (callback at root, cookie scoped to basePath)
  instead of forcing it.
- The spike shows route-handler wrapping requires touching all ~15 handlers
  individually with no shared seam — surface that as a refactor precondition
  (a `withGuards()` wrapper plan) rather than baking boilerplate into the
  design.

## Maintenance notes

- Phase 6 replaces "allowlist of subjects" with real identity; write the
  allowlist section so it is deletable.
- The Phase 9 public persona routes ship rate limiting as their own
  acceptance item — the auth spec should not absorb that.
- When this lands, update `infra/k8s/ingress.yaml`'s comment and the two
  Fargate guides: external gates become *an option*, not the only story.
