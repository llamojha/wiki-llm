# Ask-wiki agent

## What it does

A Bedrock Nova 2 Lite (`amazon.nova-2-lite-v1:0`) tool-use loop
(`web/lib/agent.ts`) that answers questions grounded in the vault's own
content: it searches, reads documents, cites sources, and can propose new
pages — but **every write is user-confirmed**, never autonomous. This is a
hard constraint from the product philosophy (`.kiro/steering/philosophy.md`
"User-Confirmed Writes"), not a soft preference.

## The loop

`web/lib/agent.ts` drives a Bedrock Converse-stream + tool-use loop, capped
at `MAX_ROUNDS = 6` rounds and `MAX_TOKENS_PER_TURN = 4096`. It yields a
typed `AgentEvent` envelope (`text` deltas, `tool_use`, `tool_result`,
`cite`, `propose_page`, `refuse`, `warning`, `done`, `error`) that
`web/app/api/chat/route.ts` marshals onto an NDJSON wire format for the
client `chat-panel.tsx` to render incrementally.

Three tools (`web/lib/agent-tools.ts`, `TOOL_SPECS`):
- `search_vault` — searches the in-memory Fuse.js index.
- `read_document` — reads one document's full content.
- `propose_page` — the *only* write-shaped tool, and it doesn't write
  anything itself — it emits a `propose_page` event with a slug, title, and
  body that the UI renders as a confirmation card. The user must explicitly
  approve before any S3 `PutObject` happens.

## Grounding and refusal

Two distinct signals guard against unsupported answers:
- `refuse` (`reason: 'no-sources'`) — the agent searched and got zero hits;
  it declines to answer rather than generating from parametric knowledge,
  with an optional `canForce` escape hatch for the user to request an answer
  anyway.
- `warning` (`reason: 'no-reads'`) — a softer signal for the case where the
  agent searched, got hits, but never actually called `read_document` on
  any of them before answering. The answer is still shown, but the UI flags
  it as uncited so the reader knows to treat it carefully. This closes a gap
  where an agent could technically satisfy "it searched" without ever
  grounding the answer in a document's actual content.

## Context injection

When the user has a document open in the reader, its title is resolved once
and embedded into the system prompt as "Currently-open document"
(`contextDocId` in `RunAgentOpts`) — this is what makes "what does this say?"
target the open document instead of falling back to catalog-wide title
matching.

## Scope

The agent respects the same shared/per-user scope split as the rest of the
portal (`ScopeMode` in `agent-tools.ts`) — `searchVault`/`readDocument` only
see documents the requesting scope is allowed to see
(`isInAllowedScope`).

## Debugging

`DEBUG_AGENT=1` streams every round's stop reason and each tool call/result
to the server log — useful for reproducing a multi-round loop interactively
without adding temporary console.log calls.

## Things to watch when editing

- `propose_page` must stay a preview-only tool. Any change that makes it
  write directly violates the user-confirmed-writes constraint — this is
  treated as a hard constraint, not something to relax for convenience.
- The 1M token context window means "dump the whole vault into the prompt"
  is tempting but wrong — the intended pattern is keeping a catalog/index in
  the prompt and reaching for `read_document` for full-doc reads, not
  preloading content.
- Bedrock region/model come from `BEDROCK_MODEL`/`BEDROCK_REGION` — a
  cross-region inference profile (`eu.`/`us.` prefix) may be required
  depending on home-region model availability; this is a deployment
  concern, not something to hardcode.

## Source references

- `web/lib/agent.ts` — the loop, event envelope, round/token caps.
- `web/lib/agent-tools.ts` — tool specs and implementations.
- `web/lib/agent-prompts.ts` — system prompt assembly.
- `web/app/api/chat/route.ts` — NDJSON wire adapter, gated by `FEATURE_AGENT`.
- `specs/phase-5-ask-wiki-agent.md` — original design details.
- `.kiro/steering/philosophy.md` — the user-confirmed-writes constraint.
