# Phase 5 — Ask-Wiki Agent

**Milestone:** MVP 2 (with Phase 4)

## Goal

Embed a Bedrock-powered conversational agent in the chat panel that answers questions grounded in the user's vault content, with citations and user-confirmed page creation.

## Vision

A user asks a question in the chat panel and gets an accurate, cited answer drawn from their own documents — or a clear refusal when no relevant content exists. When the user asks the agent to generate content, it renders a preview and offers to save it as a new page.

## Objective

Implement a streaming `/api/chat` Route Handler with Bedrock converse API, tool-use (search, read, propose), scoped search, citation rendering, and refusal behavior.

## Architecture

```
web/app/api/chat/route.ts     POST — streaming response (ReadableStream)
web/lib/agent.ts              Agent loop: system prompt + tool dispatch
web/lib/agent-tools.ts        Tool implementations (call lib/s3, lib/search directly)
```

The agent tools call existing library modules directly — no HTTP round-trips:
- `search_vault` → `lib/search.ts`
- `read_document` → `lib/s3.ts`
- `propose_page` → returns structured preview to the client

## Key Decisions

- **Route Handler with streaming** — `POST /api/chat` returns a `ReadableStream` for real-time token delivery.
- **Bedrock converse API** — `@aws-sdk/client-bedrock-runtime` `ConverseStream` command. Model: `amazon.nova-2-lite-v1:0`.
- **Tools are direct function calls** — no HTTP, no separate service. The agent loop calls `lib/search.ts` and `lib/s3.ts` directly.
- **No Postgres** — scoped search uses Fuse.js with path-based filtering.
- **User-confirmed writes only** — the agent never writes autonomously. `propose_page` returns a preview; the client sends a separate confirmation request to create the page.
- **Chat persistence deferred** — chat lives in browser memory for the session. Server-side logging for analytics only.

## Design Details

### Query Flow — hybrid index-first

The agent uses a **two-tier strategy** when deciding what to read.

```
┌──────────────────────────────────────────────────────────────┐
│  System prompt (sent on every turn):                          │
│  • Role + tool protocol + refusal/citation rules              │
│  • Catalog: contents of <scope>/_system/index.md              │
│    — one line per doc: "<key> — <title> — <first 80 chars>"   │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
            ┌─────────────────────────────────────┐
            │  Agent reads catalog. Decides:      │
            └─────────────────────────────────────┘
                              │
        ┌─────────────────────┴─────────────────────┐
        ▼                                           ▼
  Catalog entry obviously                     Ambiguous or no
  matches the question                        obvious match
        │                                           │
        ▼                                           ▼
  read_document(<id>)                       search_vault(<query>)
  (1 tool call)                             then read_document
                                            on top hits
                                            (2–N tool calls)
```

**Why hybrid (not index-only or search-only):**

- Index-only fails on ambiguous queries — entries are summary lines, not full content. The agent can't distinguish two docs whose titles are similar.
- Search-only loses the global picture — the agent never sees what's in the vault, just point-results.
- Hybrid lets the agent pick the cheapest correct path per question.

**Index size budget:**

Each catalog line is ~150 chars (`<key> — <title> — <80-char summary>`). At a 30k-char budget in the system prompt, ~200 entries fit comfortably. Nova Lite's 1M-token context can take more — we cap at 30k to leave headroom for tool results.

**Scaling beyond 200 docs:** later passes will switch to slimmer entries (`<key> — <title>`, ~60 chars, fits ~500) or per-space indexes loaded on demand. Out of scope for Phase 5 — flag if the vault grows past 200 docs.

**Stale-index defense:** if `read_document` 404s (catalog points at a deleted file), agent retries with `search_vault` to recover.

### Three tools — direct in-process function calls

| Tool | Signature | Implementation | Behavior |
|---|---|---|---|
| `search_vault` | `(query, scope?, limit?)` | wraps `lib/search.ts::search()` then filters by scope prefix | Returns ranked candidate doc IDs + titles + snippets |
| `read_document` | `(doc_id)` | wraps `lib/s3.ts::getObject()` + `gray-matter` parse | Returns title, section (first heading), body, scope of the doc |
| `propose_page` | `(slug, title, body)` | passthrough — does NOT write | Yields a preview event to the client; user-confirmed write goes through `POST /api/docs` |

No HTTP between agent and tools. They run in the same Node process as the Route Handler.

### Scope semantics — user-configurable per chat

The chat panel exposes a **scope selector** in the context bar with three options:

| Mode | Reads from | Writes to |
|---|---|---|
| `shared` | shared roots only | n/a (writes always personal) |
| `user` | active user's subtree only | user's `authored/personal/` |
| `both` (default) | shared + active user's subtree | user's `authored/personal/` |

**Read-broadly, write-narrow rationale:**

- The dominant use case is *synthesis* — compiling notes from shared team sources into personal notes. Restricting reads to one scope blocks this.
- Writes always landing in personal preserves user agency: the user is never surprised by where the agent puts content.
- Citations may cross scopes — a generated personal page can cite shared docs. That's the point.

**Future (Phase 6 multi-tenant):** "accessible scopes" become a permission-derived set rather than fixed. The tool signatures already carry scope filters, so this is additive.

### Generation triggering — two coexisting paths

Two ways the user can produce a markdown page from the agent.

#### Path A: implicit (model-detected `propose_page`)

The agent infers generation intent from the user's phrasing and calls `propose_page(slug, title, body)`. The route emits a `{ type: 'propose_page', ... }` event. The chat panel renders a **preview block** inline: title at the top, body rendered as Markdown, plus a primary **Save** button and a **Discard** button. Save → `POST /api/docs` → on 201 the new doc is opened.

Trigger heuristics encoded in the system prompt:
- Strong signal: imperative verbs ("write me", "draft", "generate", "create a page for", "compile a doc on")
- Weak signal: long structured request where the answer is page-shaped
- No signal: question-answer turns

The agent is instructed to *prefer not* calling `propose_page` when unsure. Better to answer normally and let the user use Path B.

#### Path B: post-hoc save (button on every answer)

Every assistant message has a **Save as page** button below the bubble (this already exists in the mocked chat panel). Clicking it:

1. Constructs a draft from the rendered answer text + the citation list as a Markdown body
2. **Opens the Editor pre-filled** with that draft, title seeded from the question
3. User reviews, edits, saves through the existing Editor → `POST /api/docs` path

Why route through the Editor: the agent's conversational answer was not designed as a page. Letting the user tidy it up before saving is the right UX, and reuses Phase 4 infrastructure.

#### Comparison

| | Path A — implicit | Path B — post-hoc |
|---|---|---|
| Output quality | Designed as a page (headings, structure) | Conversational; user edits |
| Friction | One Save click | Editor session |
| When to use | Explicit "write me X" requests | Casual save of a useful answer |
| Citations | Embedded in the preview | Appended to the draft |

### Empty-source generation — refuse, then user-forced

When the user asks for generation but no vault sources match (search returns nothing relevant after at least one tool call):

1. **Agent refuses** with a clear message: *"I couldn't find anything in your vault on this topic. I won't draft a page from prior knowledge by default — would you like me to draft anyway, without citations?"*
2. The chat panel renders an explicit **"Draft anyway (no sources)"** button next to the refusal.
3. Clicking the button sends a follow-up request with a flag (`{ message: '...', forceUnsourcedGeneration: true }`).
4. On the flagged request, the agent skips the search step, generates the page from prior knowledge, and emits a `propose_page` event with a preview body that **begins with an explicit "_No vault sources — drafted from general knowledge._" banner**.
5. The save flow is otherwise identical to Path A.

Why client-side button (not model-side phrase detection): an explicit button is unambiguous and auditable. "Draft anyway" as freeform phrasing would be fuzzy and easy to abuse to bypass the refusal policy. The button is the only path to unsourced generation.

This preserves the **no-hallucination** product guarantee while honoring user agency: the user is in full control of whether unsourced content gets created, and the page itself carries the unsourced provenance forward as visible text.

### Citations

Built **deterministically from `read_document` tool calls**, not from model output.

- Every distinct doc ID the agent read during the turn becomes one cite event.
- Cite shape: `{ id: <s3-key>, title: <from frontmatter or filename>, section: <first heading or "Source"> }`.
- The chat panel renders each cite as a clickable button; clicking calls `onOpenDoc(id)` which opens the doc in the main reader.
- The agent is instructed to embed `[1]`, `[2]` markers in the response text matching the cite order, but the cite array itself is constructed by the route handler from the tool-use log, not from text parsing.

This means: **an agent that never calls `read_document` can never produce citations**. If you see citations, you know they were grounded.

### System prompt structure

One prompt assembled per request:

```
1. Role        — "You are Vaultmark's wiki assistant. Answer questions grounded
                  in the user's own documents."

2. Tool protocol
   - "You have three tools: search_vault, read_document, propose_page."
   - "Prefer reading directly from the catalog when an entry obviously matches."
   - "Use search_vault when the catalog hint is insufficient."
   - "Read every doc you intend to cite via read_document — citations are
      generated from your reads, not your claims."

3. Refusal policy
   - "If no relevant content is found after at least one tool call, say so
      explicitly and stop. Do not fabricate."
   - "For generation requests with no sources, refuse and suggest the user
      can opt into unsourced drafting."

4. Generation rules
   - "Only call propose_page when the user explicitly asks you to draft, write,
      or generate a page. Casual Q&A turns must not call it."
   - "When forceUnsourcedGeneration is set, begin the body with the banner:
      '_No vault sources — drafted from general knowledge._'"

5. Citation rules
   - "Embed [n] markers in your prose corresponding to the order you read docs.
      The client renders these as clickable citations."

6. Scope context  — "Active scope: <shared | user | both>. Catalog below
                     reflects this scope."

7. Catalog        — verbatim contents of <scope>/_system/index.md
                     (or a merged catalog for 'both' scope, sectioned by source)
```

### NDJSON event envelope (route → client)

Every event from `POST /api/chat` is one JSON object per line:

```json
{ "type": "text", "delta": "..." }                           // streamed text
{ "type": "tool_use", "name": "search_vault", "input": {} }  // observability
{ "type": "tool_result", "name": "...", "ok": true }         // observability
{ "type": "cite", "id": "...", "title": "...", "section": "..." }
{ "type": "propose_page", "slug": "...", "title": "...", "body": "..." }
{ "type": "refuse", "reason": "no-sources", "canForce": true }
{ "type": "done" }
{ "type": "error", "detail": "..." }
```

The `refuse` event with `canForce: true` is what triggers the **Draft anyway** button in the chat UI.

## Acceptance Criteria

1. `POST /api/chat` accepts a user message and streams a response via ReadableStream.
2. The agent loads `<scope>/_system/index.md` into the system prompt as its catalog and decides per-query whether to read directly or call `search_vault` first.
3. Tool `search_vault(query, scope?)` searches via Fuse.js with scope support (`shared` / `user` / `both`).
4. Tool `read_document(doc_id)` retrieves full Markdown content from S3 via `lib/s3.ts`.
5. Tool `propose_page(slug, title, body)` renders a preview in the chat UI; the page is only written to S3 after explicit user approval via `POST /api/docs`.
6. The chat panel has a **scope selector** (`shared` / `user` / `both`), default `both`. Selected scope flows through every request and is honored by all three tools.
7. **Path A generation**: agent calls `propose_page` on explicit generation requests; preview renders inline with Save / Discard.
8. **Path B post-hoc save**: every assistant message has a Save-as-page button that opens the Editor pre-filled with the answer + citations.
9. **Empty-source generation**: agent refuses by default; chat UI shows a "Draft anyway" button that sends `forceUnsourcedGeneration: true`; the resulting preview body opens with an explicit "_No vault sources — drafted from general knowledge._" banner.
10. **Citations are derived from `read_document` calls**, not from response text. An agent that didn't call `read_document` produces zero citations.
11. The agent refuses to answer (with a clear message) when no relevant content is found, after at least one tool call.
12. Citations in responses link to the source documents in the portal via `onOpenDoc(id)`.
13. Generated pages land in `users/<id>/authored/personal/<slug>.md` regardless of read scope — write-narrow, read-broadly.
14. Bedrock model is `amazon.nova-2-lite-v1:0` (cross-region `us.amazon.nova-2-lite-v1:0` when needed), controlled by `BEDROCK_MODEL` env.
15. Chat interactions are logged server-side to `<scope>/_system/usage-log.jsonl` for usage tracking.
16. ChatPanel mock (`CANNED_REPLIES`, `DEFAULT_REPLY`) is fully replaced with real agent interaction.

## Open Questions

- **Index scaling past 200 docs**: when to switch to slimmer entries vs per-space indexes loaded on demand. Defer until vault size forces the conversation.
- **Cite section granularity**: today the cite's `section` is the doc's first heading. For long docs, a per-section cite (which `##` in the doc the agent actually used) would be richer. Requires the agent to emit section markers — defer.
- **Multi-tenant scope filtering**: `search_vault`'s scope filter is currently prefix-based on the in-memory Fuse index that walks all S3. Multi-tenant requires scope-isolated indexes; Phase 6.
- **Chat history persistence**: in-browser only for MVP. Server-side storage is Phase 6 territory.
- **Streaming Markdown rendering**: text deltas accumulate into a plain-text buffer; final rendering through `renderMarkdown` happens on `done`. Live Markdown rendering mid-stream is non-trivial (incomplete fences, partial links) and not worth the complexity for Phase 5.

## Implementation Notes (shipped 2026-05-18)

**Architecture realized exactly as specified.** Foundation (`bedrock.ts`, `agent-tools.ts`, `agent-prompts.ts`) + core (`agent.ts`, `usage-log.ts`, `/api/chat/route.ts`) + UI rewrite (`chat-panel.tsx`). No HTTP between agent and tools — all in-process.

**Force-unsourced is a prompt branch, not a runtime flag in the loop.** `buildSystemPrompt` switches the entire "Generation rules" section based on `forceUnsourcedGeneration`. The agent loop carries the flag for the refusal short-circuit at the end of a turn (don't refuse on no-hits if the user explicitly opted into unsourced) but the loop logic is otherwise unchanged. Cleaner than threading runtime branches through the iteration.

**`runtime: 'nodejs'` on the route.** Vercel Edge has a 60s timeout; agent runs with 6 tool-use rounds can exceed that. Node serverless allows up to 300s. Also added `X-Accel-Buffering: no` so downstream proxies (Nginx, CDN) don't buffer the chunked NDJSON.

**`DocumentType` mirrored locally.** The Bedrock SDK's `ToolUseBlock.input` and `ToolResultBlock.content[].json` types are `DocumentType` from `@smithy/types` — a transitive dep that's not directly importable. Inlined a local `type DocumentType` alias in `agent.ts` matching the recursive JSON-value shape rather than adding a direct `@smithy/types` dep.

**Citation emission is deterministic from `read_document` calls.** The route never parses model output to extract citations. The agent loop maintains a `Map<id, ReadDocumentResult>` of every successful `read_document`; on `end_turn`, one `cite` event is emitted per unique entry. An agent that didn't call `read_document` cannot produce citations even if it embeds `[1]`, `[2]` markers in its prose. This is the no-hallucination guarantee enforced at the protocol level.

**Catalog assembly for `both` scope.** The route loads both `_system/index.md` and `users/<id>/_system/index.md`, concatenates them with `### Shared library` and `### My library (<id>)` section headers, and embeds the merged string in the system prompt. The agent can tell sources apart.

**Post-hoc Save routes through the Editor, not directly to `/api/docs`.** The chat panel's "Save as page" button hands a draft (title + body with appended `## Citations` section) to a new `onDraftFromChat` callback on app-shell. App-shell sets `editorDraft`, scope to user, `activeId = '__new'`, opens the Editor. The Editor's new `initialDraft` prop seeds the title and body, taking precedence over `doc`. User reviews/edits and saves via the existing Phase 4 CRUD path. Two-step save preserves user agency over conversational answers that weren't designed as pages.

**Path A (implicit `propose_page`) renders inline.** No editor detour; the preview block in the chat shows the slug, title, body, and Save/Discard buttons. Save POSTs `/api/docs` directly with the agent-provided body. 409 surfaces the server's `detail` in an error toast and leaves the preview open.

**Scope selector is on the chat panel itself, not bound to the sidebar.** The sidebar's scope toggle controls which content shows in the tree; the chat's scope toggle controls what the agent searches. They're independent on purpose — a user might want to *navigate* shared while *asking* against both.

**`CANNED_REPLIES` and `DEFAULT_REPLY` removed from `lib/canned-replies.tsx`.** Only `SUGGESTIONS` remains for the empty-state. The module's purpose is now documented.

**Manual smoke checklist** lives at `web/lib/__smoke__/phase-5-agent.md`. 8 scenarios covering the happy path, refusal, both generation paths, slug collision, scope selector, stream cancellation, and context-doc hint.

### Verified
- `pnpm typecheck` clean
- `pnpm build` clean — `/api/chat` shows up as a dynamic route
- Lambda regression: `tsc --noEmit` clean, `npm test` 17/17 pass

### Known gaps (still open)
- No runtime smoke walked through yet — checklist in `web/lib/__smoke__/phase-5-agent.md` is the gate
- Editable slug in the preview block (currently fixed by the agent)
- Slug-collision retry UX (currently the user has to re-ask the agent for a different title)
- `pnpm/web` has no test runner — no automated tests for the agent loop
- IAM: the web runtime needs `bedrock:InvokeModel*` permissions; not yet added to whatever the deployment uses

## v2 fixes shipped 2026-05-18

Follow-up batch after the v1 postmortem. All 11 issues identified there were addressed.

| # | Severity | Fix |
|---|---|---|
| 1 | P1 | Scope filter: replaced `.includes` substring match with `inferScopeFromKey`-based strict check. Shared scope no longer leaks user-scope keys. |
| 2 | P1 | `contextDocId` now uses the relative key (added `id` to `LiveDoc`, sourced from the API response's `id` field). Full prefixed `s3` stays display-only. |
| 3 | P1 | Replaced `readFinalText`'s `setMessages`-as-sync-read with `textBufRef: useRef<Map<string, string>>`. No more React batching fragility. |
| 4 | P2 | Threaded `AbortSignal` from the route's `req.signal` through `runAgent` → `converseStream` → SDK. Client disconnect cancels the Bedrock call. |
| 5 | P1 | Chat panel sends `history` (last 10 prior messages, intro and streaming-in-progress messages excluded) on every `/api/chat` request. Multi-turn context works. |
| 6 | P2 | New `warning` event surfaces when the agent answers without reading any source. Chat UI renders an amber banner under the bubble. |
| 7 | P2 | Light inline Markdown during streaming — `**bold**`, `*italic*`, `` `code` `` render in place via `renderLightInline`. Headings/fences/links wait for final pass. |
| 8 | P2 | `tool_use` events now drive a live activity indicator under streaming messages ("searching for…", "reading auth-design.md…", "drafting a new page…"). |
| 9 | P3 | Inline styles on `propose_page` preview + warning + agent-activity blocks replaced with CSS classes in `globals.css`. |
| 10 | P3 | Editor shows a "drafted from chat" tag chip when opened with an `initialDraft`. |
| 11 | P2 | System prompt now includes three short few-shot examples (Q&A with citation, explicit generation, no-hits refusal) — added after Examples section, scoped to non-forced mode. |
