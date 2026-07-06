# Secure agentic access to the vault (MCP-class, hardened)

> **Status**: DESIGN (plan 023). Deliverable spec + threat model +
> recommendation; implementation is a follow-up plan that **must not start
> before plans 002 and 009 land** (they close read-path gaps any external
> access inherits). No default-behavior change ships with this spec.
>
> **MCP facts re-verified**: 2026-07-05 against the current Model Context
> Protocol spec. MCP defines `stdio` and streamable-HTTP transports; an
> OAuth 2.1-based authorization framework applies to HTTP transports; tool
> annotations (`readOnlyHint`, `destructiveHint`) exist but are **hints, not
> enforcement**. Nothing below depends on annotations for a security property.

## Why

The maintainer wants external agents (Claude Code, IDE agents, other LLM tools)
to work against a Canopy vault. The obvious shape is an MCP server — but
plain MCP over stdio/HTTP with ambient credentials is a real worry: the portal
has **no auth layer** (single-user MVP by design), so any network-exposed
agentic endpoint is an unauthenticated read/write channel into the knowledge
base. One hard constraint works in our favor: **user-confirmed writes** ("No
autonomous agent writes … a hard constraint, not a preference" —
`.kiro/steering/philosophy.md`). This spec keeps that enforceable at the
*protocol* level, not by prompt-politeness.

## What exists to build on

- **The tool layer is the right seam.** `web/lib/agent-tools.ts` defines three
  tools with Bedrock-shaped JSON schemas: `search_vault`, `read_document`,
  `propose_page`. Scope enforcement already lives *in* the tool layer
  (`isInAllowedScope`; `readDocument` rejects out-of-scope keys before any S3
  call). `propose_page` is a **pure passthrough** — it never writes; the user's
  Save click hits `POST /api/docs`. An external protocol wraps **these
  functions**; it invents no new capabilities.
- **HTTP surface**: 19 route handlers under `web/app/api/`, each `flagGuard`-ed
  (404 when its feature is off), **no authentication anywhere**; deploy targets
  include public hosts (Vercel/Fargate).
- **Audit primitives**: `_system/log.md` + usage-log JSONL, restructured to
  per-event objects by plan 011 — the gateway writes the same events.
- **Vault-content agent policy** is already a product concept (PRD §12 names
  `AGENTS.md`/`WIKI_RULES.md` as content future agents read) — the natural home
  for per-vault access policy (§6).

## 1. Threat model (internet-reachable vault gateway)

| Threat | Today's exposure | The design's answer |
|---|---|---|
| **Unauthenticated access** | total — any reachable port reads/writes | `FEATURE_AGENT_ACCESS` off by default; when on, **every** call needs a capability token; no token ⇒ 401 |
| **Stolen / leaked token** | n/a (no tokens) | tokens are scoped + expiring + rate-budgeted; revocable by deletion; hashed at rest; leak ≠ full-vault access |
| **Confused deputy** (calling agent is prompt-injected by vault content it read) | model politeness only | enforcement is server-side at tool dispatch, **not** in the model; a token can't exceed its capability set no matter what the model is told; mirrors the `agent-tools.ts` scope-check-despite-injection comment |
| **Capability escalation** (read token used to write) | n/a | the only mutating capability is `propose` → pending queue → human approval; a read token literally cannot enqueue a write |
| **Exfiltration volume** (bulk-read whole vault with one token) | unbounded | per-token read **budget** (reads/hour) + optional folder-prefix restriction; budget exhaustion ⇒ 429 |
| **Replay** | n/a | tokens carry expiry; HTTP transport is TLS-only; short TTLs recommended for hosted |
| **Audit evasion** | no audit of external access | every dispatch writes a plan-011 event (tool, token id, args digest, result size) *before* returning |

## 2. Transport / protocol options

| Option | Ecosystem fit | Security posture | Verdict |
|---|---|---|---|
| **A. MCP streamable-HTTP + capability tokens** | maximal (Claude Code/Desktop, IDEs speak it) | ours to enforce server-side | **recommended (hosted)** |
| **B. MCP stdio, local-only** | high, zero network surface | no port = no remote attack surface | **recommended (local/single-user)** |
| **C. Plain REST + API keys** | low (every agent needs custom glue) | simple to reason about | rejected — loses the ecosystem |
| **D. Signed capability URLs (per-doc grants)** | narrow-sharing only | good for one-off shares | rejected as the primary — poor fit for interactive search loops |

**Recommendation: both MCP transports over ONE internal gateway module.** stdio
for local (`canopy mcp` next to your creds, no port), streamable-HTTP for
hosted. The gateway wraps `agent-tools.ts`; **all security properties live in
the gateway, not the protocol**:

- **Deny-by-default capability tokens.** A token names: allowed tool set
  (`search` / `read` / `propose`), a scope (`shared` / `user:<id>`, reusing
  `ScopeMode` + plan 009's validated `userId`), an optional folder-prefix
  restriction (reuse `searchScoped`'s folder filter), an expiry, and a
  read/volume budget. Enforced at tool dispatch — exactly where
  `isInAllowedScope` already sits.
- **No autonomous writes, protocol-enforced.** The only mutating capability is
  `propose_page`; the proposal lands in a **pending queue**
  (`_system/proposals/<id>.json`) surfaced in the portal for the user to
  approve (mirrors the chat propose→Save flow). The external agent never
  receives a capability that skips confirmation.
- **Audit every call** → plan-011 event shape.
- **Token issuance (pre-Phase-6).** Operator-minted via CLI/env, **hashed at
  rest** under `_system/`, rotated by deletion. Written to be **deleted** when
  Phase 6 identity arrives.

## 3. Feature-flag & deployment posture

- `FEATURE_AGENT_ACCESS` (proposed) — **default off**, route guard 404 like
  every other flag; `docs/feature-flags.md` gains a row. Gate **both layers**:
  the HTTP transport route 404s when off; the stdio entrypoint refuses to start.
- **stdio variant** ships as a separate CLI entrypoint that never binds a port
  — safe by construction for the single-user case.
- **Hosted variant** documented with the "flags gate both layers" discipline;
  TLS required; short token TTLs recommended.
- **Interaction with the portal's own Bedrock agent**: they share
  `agent-tools.ts`. **Recommend unifying** budgets + audit across both, so the
  in-portal agent and external agents obey one policy and write one audit
  stream.

## 4. Precedence vs the human auth gate (plan 024)

Plan 024 designs the *human session* gate (OIDC). Both guard the same handlers
eventually. **Precedence rule (stated identically in both specs):** on the
agentic endpoints, a valid capability token **bypasses** the human session gate
(it *is* the auth); everything else requires a session when `AUTH_MODE=oidc`.
A capability token is never accepted on human/browser routes.

## 5. Roadmap

- **v1**: stdio local, **read-only** tools (`search_vault`, `read_document`) +
  the `propose_page` → pending-queue path. No network surface. Ships the
  gateway module, token minting CLI, and the proposal-queue UI.
- **v2**: streamable-HTTP transport + capability tokens + budgets + rate limits;
  hosted-deployment docs.
- **Non-goals**: general auth/user system (Phase 6); any write tool beyond
  propose/confirm (philosophy invariant); annotation-based "trust."

## 6. Open questions

1. **Proposal-queue UX** — a new portal surface, or fold into the existing
   chat propose→Save card? Recommend: a dedicated "Proposals" review list
   (external proposals have no chat thread to attach to).
2. **Path redaction for shared-scope tokens** — should `search_vault` results
   redact `users/` paths entirely for a `shared`-scoped token? Recommend: yes;
   a shared token should not even learn that user paths exist.
3. **Token format — random opaque vs JWT.** Recommend random opaque (hashed at
   rest, server-side lookup) for v1 — no signing-key management, trivial
   revocation; revisit JWT only if stateless multi-node hosting demands it.
4. **Per-vault agent policy** — wire `WIKI_RULES.md`/`AGENTS.md` (PRD §12) as
   a policy input (e.g. "external agents may not read folder X")? Recommend:
   connect in v2, don't implement in v1.
5. **Budget granularity** — per token, or per token × tool? Recommend per token
   (simpler mental model) with a global read-budget; refine if abuse patterns
   emerge.

## Test matrix (for the implementation plan)

Scope-escape attempts per token shape; expired token → 401; budget exhaustion →
429; propose → approve → write happy path; propose without approval never
writes; flag-off → 404 (both transports); stdio entrypoint refuses to bind a
port; audit event written for every dispatch; capability token rejected on
human routes.
