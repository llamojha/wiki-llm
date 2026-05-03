# Phase 5 — Ask-Wiki Agent

**Milestone:** MVP 2 (with Phase 4)

## Goal

Embed a Bedrock-powered conversational agent in the chat panel that answers questions grounded in the user's vault content, with citations and user-confirmed page creation.

## Vision

A user asks a question in the chat panel and gets an accurate, cited answer drawn from their own documents — or a clear refusal when no relevant content exists. When the user asks the agent to generate or collect data, it renders a preview and offers to save it as a new page.

## Objective

Implement the streaming `/chat` endpoint, Bedrock agent loop with tool-use (search, read, propose), scoped search, citation rendering, and refusal behavior.

## Key Decisions

- **Scoped search lands here** — `search_vault(query, scope)` supports all / folder / page scopes. The UI search (Phase 2) stays global; scoped search is agent-only.
- **Agent proposes new pages only** — no edits to existing pages. The agent renders generated content as a preview, then offers to save. Only triggered when the user explicitly asks for data generation/collection.
- **Chat persistence deferred** — get the agent working first. Chat lives in memory/browser for the session. Server-side logging for analytics only. Persistence (resumable sessions) is a follow-up.
- **User-confirmed writes only** — the agent never writes autonomously. Every proposed page requires explicit user approval.

## Acceptance Criteria

1. `POST /chat` accepts a user message and streams a response via SSE or chunked transfer.
2. The agent reads `index.md` as its catalog and uses tools to answer questions.
3. Tool `search_vault(query, scope)` queries Postgres FTS with scope support (all / folder / page).
4. Tool `read_document(doc_id)` retrieves the full Markdown content of a document from S3.
5. Tool `propose_page(slug, title, body)` renders a preview in the chat UI; the page is only written to S3 after explicit user approval.
6. The agent refuses to answer (with a clear message) when no relevant content is found in the vault.
7. Scope selection works: user can constrain the agent to all docs, a folder, or a single page.
8. Citations in responses link to the source documents in the portal.
9. The agent only proposes new pages when the user explicitly asks it to generate or collect data.
10. The Bedrock model is `amazon.nova-2-lite-v1:0` (cross-region `us.amazon.nova-2-lite-v1:0` when needed).
11. Chat interactions are logged server-side for usage tracking.
12. Chat answers include at least one source link when answering from docs.
13. ChatPanel mock is fully replaced with real agent interaction.
