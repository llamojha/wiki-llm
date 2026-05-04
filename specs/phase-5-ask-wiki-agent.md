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

## Acceptance Criteria

1. `POST /api/chat` accepts a user message and streams a response via ReadableStream.
2. The agent reads `index.md` as its catalog and uses tools to answer questions.
3. Tool `search_vault(query, scope)` searches via Fuse.js with scope support (all / folder / page).
4. Tool `read_document(doc_id)` retrieves full Markdown content from S3 via `lib/s3.ts`.
5. Tool `propose_page(slug, title, body)` renders a preview in the chat UI; the page is only written to S3 after explicit user approval.
6. The agent refuses to answer (with a clear message) when no relevant content is found.
7. Citations in responses link to the source documents in the portal.
8. The agent only proposes new pages when the user explicitly asks for content generation.
9. Bedrock model is `amazon.nova-2-lite-v1:0` (cross-region `us.amazon.nova-2-lite-v1:0` when needed).
10. Chat interactions are logged server-side for usage tracking.
11. ChatPanel mock is fully replaced with real agent interaction.
