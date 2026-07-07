# Plan 023: Design secure agentic access to the vault (MCP-class, hardened)

> **Executor instructions**: This is a **design/spike plan** — the deliverable
> is a written spec with a threat model and a recommendation, NOT an
> implementation. Follow the steps, honor STOP conditions, and update
> `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- web/lib/agent-tools.ts web/lib/flags.ts web/app/api/ prd_canopy_markdown_llm_wiki.md`
> On material drift in the tool/route layer, re-derive "Current state".

## Status

- **Priority**: P2
- **Effort**: M (design; implementation follows as its own plan)
- **Risk**: LOW as a spec; the surface it designs is the highest-stakes one in the product
- **Depends on**: plans/002 and /009 SHOULD land first (they close read-path
  gaps any external access would inherit); cite both
- **Category**: direction / design
- **Planned at**: commit `fead8f9`, 2026-07-03

## Why this matters

The maintainer wants external agents (Claude Code, IDE agents, other LLM
tools) to work against a Canopy vault — the obvious shape is an MCP
server, but plain MCP-over-stdio/HTTP with ambient credentials worries them,
reasonably: the portal currently has NO auth layer at all (single-user MVP by
design), so any network-exposed agentic endpoint would be an unauthenticated
read/write channel into the knowledge base. The product also has a hard
constraint working in its favor: **user-confirmed writes** ("No autonomous
agent writes … This is a hard constraint, not a preference" —
`.kiro/steering/philosophy.md`). This plan designs agentic access that keeps
that constraint enforceable at the protocol level, not by prompt-politeness.

## Current state (what exists to build on)

- **An internal tool layer already exists and is the right seam.**
  `web/lib/agent-tools.ts` defines exactly three tools with JSON schemas
  (Bedrock `Tool` shape): `search_vault`, `read_document`, `propose_page`.
  Scope enforcement is IN the tool layer (`isInAllowedScope`, lines 161-175;
  `readDocument` rejects out-of-scope keys before any S3 call), and
  `propose_page` is a **pure passthrough** — it never writes; the user's Save
  click hits `POST /api/docs` (lines 213-223). An external protocol can wrap
  THESE functions rather than invent new capabilities.
- **HTTP surface**: route handlers under `web/app/api/` with `flagGuard`
  gating per feature (`web/lib/flags.ts:102-108`, 404 when off); no
  authentication anywhere; deploy targets include public-internet hosts
  (Vercel/Fargate — `docs/deploy/`).
- **Audit trail primitives**: `_system/log.md` appends + usage-log JSONL
  (`web/lib/usage-log.ts`), being restructured by plans/011 — an agentic
  gateway should write the same audit events.
- **MCP landscape fact to verify during the spike** (knowledge cutoff
  caveat — re-verify current spec): MCP supports stdio and streamable-HTTP
  transports; the spec has an OAuth2.1-based authorization framework for
  HTTP transports; tool annotations exist (readOnlyHint/destructiveHint) but
  are HINTS, not enforcement. "More secure than MCP" therefore concretely
  means: enforcement server-side, deny-by-default capabilities, and no
  ambient-authority tokens — all compatible WITH MCP as the wire protocol.
- Related prior art in-repo: PRD §12 names `AGENTS.md`/`WIKI_RULES.md` as
  *vault content* future agents read — vault-level agent policy is already a
  product concept; the spec should connect to it.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Recon     | `grep -rn "flagGuard\|isInAllowedScope" web/app web/lib` | map the seams |
| E2E       | `pnpm build && pnpm test:e2e` | green (no default change from any spike) |

## Scope

**In scope**:
- `specs/agentic-access.md` (create — the deliverable)
- Optional micro-spike: a LOCAL stdio MCP server in a scratch branch to
  validate the tool-wrapping seam — NOT part of the deliverable commit

**Out of scope**:
- Implementation (follow-up plan from the spec's roadmap section).
- Building a general auth/user system (Phase 6 owns identity; this spec must
  work in the single-user deployment TODAY with tokens, and slot into Phase 6
  identity later).
- Exposing write tools beyond the propose/confirm pattern — the philosophy
  doc forbids it; the spec treats that as an invariant, not an option.

## Git workflow

- Branch: `advisor/023-agentic-access-design`
- Deliverable commit: `specs/agentic-access.md` only.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Threat model first

Write the spec's threat model for an internet-reachable vault gateway:
unauthenticated access (today's baseline!); stolen/leaked token; confused
deputy (the calling agent is prompt-injected by vault content it read — note
the in-repo precedent: Hard-Rule-style injection resistance and the
`agent-tools.ts` scope-check comment about prompt-injected models);
capability escalation (read token used to write); exfiltration volume (bulk
read of a whole vault with one token); replay; audit evasion. One paragraph
each: attack, today's exposure, the design's answer.

### Step 2: Evaluate the transport/protocol options (with a recommendation)

Compare, honestly, in a table + prose:

1. **MCP (streamable HTTP) + capability tokens** — maximum ecosystem
   compatibility (Claude Code/Desktop, IDEs speak it natively); security
   depends entirely on OUR server-side enforcement (annotations are hints).
2. **MCP (stdio, local-only) against a local portal** — no network surface at
   all; zero-config for the single-user case ("run `canopy mcp` next to
   your vault creds"); doesn't serve hosted deployments.
3. **Plain REST facade + API keys** — simplest to reason about; every agent
   needs custom glue (loses the ecosystem).
4. **Signed capability URLs (per-document read grants)** — great for narrow
   sharing; poor fit for interactive agent search loops.

Recommended shape to argue (adjust if the spike disagrees): **both MCP
transports over ONE internal gateway module** — stdio for local, streamable
HTTP for hosted — where the gateway wraps `agent-tools.ts` functions and ALL
security properties live in the gateway, not the protocol:

- **Deny-by-default capability tokens**: a token names an allowed tool set
  (`search`, `read`, `propose`), a scope (`shared` / `user:<id>` — reusing
  `ScopeMode` + plans/009's validated userId), optional folder-prefix
  restriction (reuse `searchScoped`'s folder filter concept), an expiry, and
  a rate/volume budget (reads per hour). Server-side enforcement at the tool
  dispatch, exactly where `isInAllowedScope` already sits.
- **No autonomous writes, protocol-enforced**: the ONLY mutating capability
  is `propose_page` → the proposal lands in a pending queue
  (`_system/proposals/…`) surfaced in the portal UI for the user to approve
  (mirrors the existing chat propose→Save flow; the external agent never
  gets a "write" that skips confirmation).
- **Audit every call**: tool, token id, args digest, result size → the
  plans/011 event-log shape.
- **Token issuance/storage** for the pre-Phase-6 world: operator-minted via
  CLI/env (hashed at rest in `_system/`), rotated by deletion; explicitly
  marked as superseded by Phase 6 identity.

### Step 3: Feature-flag and deployment posture

Specify: `FEATURE_MCP` (or `FEATURE_AGENT_ACCESS`) default **off**, route
guard 404 like every other flag; stdio variant ships as a separate
entrypoint that never binds a port; hosted variant documented with the same
"flags gate both layers" discipline (`docs/feature-flags.md` gets a row).
State the interaction with the portal's OWN agent (they share
`agent-tools.ts`; budgets/audit apply to both? — recommend: yes, unify).

### Step 4: Optional micro-spike (timebox: half a day)

Wrap `search_vault`/`read_document` in a minimal stdio MCP server run
locally against `MOCK_S3=1`, connect a real MCP client, and confirm: (a) the
tool JSON schemas translate cleanly, (b) scope rejection errors surface
usably in the client, (c) nothing about `agent-tools.ts` needs to change
shape. Findings go in the spec; the spike code does not merge.

### Step 5: Roadmap section

End the spec with the implementation cut: v1 = stdio local, read-only tools +
propose queue; v2 = HTTP + tokens + budgets; explicit non-goals. ≤5 open
questions, each with a recommendation (candidates: proposal-queue UX,
whether search results should redact `users/` paths entirely for shared-scope
tokens, token format — random-vs-JWT).

## Test plan

Spec-stage: none beyond the spike's manual checklist. The spec must define
the implementation plan's security test matrix (scope-escape attempts per
token shape, expired token, budget exhaustion, propose→approve→write path,
flag-off 404).

## Done criteria

- [ ] `specs/agentic-access.md` with: threat model (Step 1), option table +
      argued recommendation (Step 2), flag/deploy posture (Step 3), roadmap +
      ≤5 open questions (Step 5)
- [ ] The user-confirmed-writes invariant appears as a protocol-level
      mechanism (proposal queue), not a guideline
- [ ] MCP spec facts re-verified against current documentation (note the
      version/date checked)
- [ ] No default-behavior change in the repo (e2e green; deliverable is a spec)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Re-verification of the MCP spec shows the authorization/transport landscape
  changed materially from the Current state sketch — update the sketch first;
  if the recommendation flips because of it, say so explicitly.
- The propose-queue concept conflicts with how `propose_page` events flow
  today in a way that would force chat-panel changes — note it as an open
  question rather than redesigning the chat flow inside this spec.

## Maintenance notes

- Plans/002/009 close read-path gaps that this gateway would otherwise
  inherit — implementation must not start before they land.
- Phase 6 (identity) replaces operator-minted tokens; the spec's token
  section should be written to be deletable.
- The `WIKI_RULES.md`/`AGENTS.md` vault-content concept (PRD §12) is the
  natural home for per-vault agent policy (e.g. "external agents may not
  read folder X") — connect, don't implement.
