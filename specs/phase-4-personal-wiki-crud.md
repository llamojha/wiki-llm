# Phase 4 — Personal Wiki CRUD

**Milestone:** MVP 2 (with Phase 5)

## Goal

Make Vaultmark a complete personal wiki: users can create, edit, and delete pages through the portal with full data integrity, per-page URLs, and starred documents.

## User Story

A user writes and manages their knowledge base through the browser — creating pages, editing them, starring important ones for quick access, and trusting that concurrent edits won't silently overwrite each other. Every document has a shareable URL.

## Architecture

### Write Endpoints

Write endpoints live alongside the existing read endpoints:

```
web/app/api/docs/
├── [...id]/route.ts      GET (existing) + PUT + DELETE
├── [...id]/star/route.ts PATCH (toggle starred)
└── route.ts              POST (create new doc)
```

### Routing

Per-page URLs via Next.js catch-all route:

```
web/app/
├── page.tsx              Home (/)
├── [...id]/page.tsx      Doc viewer (/wiki/my-page.md, /generated/billing.md)
├── layout.tsx            Wraps AppShell (sidebar, topbar, chat)
└── api/                  Route Handlers (unchanged path)
```

`AppShell` becomes a layout-level client component. Sidebar clicks use `router.push()`. The shell reads the current pathname to determine `activeId`.

Reserved paths excluded from catch-all: `/api`, `/dev`.

### Data Flow

```
Editor Save → POST|PUT /api/docs → S3 PutObject → regenerateIndex() → appendLog() → invalidateSearch()
                                      ↓ (412)
                                   409 → toast + reload
```

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Routing model | Full Next.js routing (`/[...id]`) | Deep-linking, bookmarking, shareable URLs, SSR-capable |
| Conflict UX | Toast + reload latest version | Simple, no merge complexity for single-user MVP |
| `index.md` format | `- path.md — Title — Summary` | LLM-friendly: title + summary avoids needing to read every file |
| `log.md` format | `- ISO \| action \| path \| "title"` | Pipe-delimited, grep-friendly, append-only |
| Concurrency | S3 ETag-based (`If-Match` header) | Native S3 optimistic locking, no external state |
| Search invalidation | Null the module-level Fuse.js promise | Lazy rebuild on next search request |
| Starred docs | `starred: true` in frontmatter | No DB needed, portable with the Markdown file |
| No Postgres | All state in S3 | Single-user MVP, no operational overhead |
| No tags | Search handles discoverability | YAGNI — tags add UI complexity without clear value yet |

## `index.md` Format

```markdown
---
title: Index
type: nav
updated: 2026-05-06T22:00:00Z
---

- wiki/getting-started.md — Getting Started — A guide to setting up your local development environment
- wiki/architecture.md — Architecture — System overview covering the three-layer design
- generated/billing.md — Billing Service — Wraps Stripe with idempotent retries and request tracing
```

Each line: `- <relative-key> — <title> — <first ~80 chars of content stripped of markdown>`

The `vault-tree.ts` parser must be updated to handle this format (extract path from before the first ` — `).

## `log.md` Format

```markdown
- 2026-05-06T22:00:00Z | created | wiki/my-page.md | "My Page"
- 2026-05-06T22:05:12Z | edited  | wiki/my-page.md | "My Page"
- 2026-05-06T23:10:00Z | deleted | wiki/old-page.md | "Old Page"
```

Append-only. One line per event. Pipe-delimited.

## Acceptance Criteria

1. `POST /api/docs` creates a new page in S3 with correct frontmatter and `source_type = personal` under `users/<user-id>/authored/personal/`.
2. `PUT /api/docs/:id` updates an existing page. Uses S3 ETag-based optimistic concurrency — concurrent edit returns 409.
3. `DELETE /api/docs/:id` removes the document from S3.
4. `index.md` is regenerated immediately after every create/delete with format `- path — Title — Summary`.
5. `log.md` is appended on every create/edit/delete event with format `- ISO | action | path | "title"`.
6. In-memory search index is invalidated on write (rebuilds lazily on next search).
7. Editor component is wired to real write endpoints (mock removed).
8. On 409 conflict: toast "This page was edited elsewhere. Reloading latest version." + reload.
9. Each document has a routable URL (`/[...id]`) mirroring its S3 key — deep-linking and bookmarking work.
10. Browser back/forward navigation works correctly between docs.
11. Users can star/unstar documents via `PATCH /api/docs/:id/star`; starred state persists in frontmatter.
12. Home view and sidebar surface a "Starred" filter showing only starred documents.
13. Mock audit complete: all `web/lib/mock/` imports removed from production paths. No mock fallbacks remain.
14. `next build` passes cleanly with zero type errors.

## Implementation Tasks

| # | Task | Dependencies | Agent |
|---|---|---|---|
| 1 | Extend `web/lib/s3.ts` with `putObject`, `deleteObject`, `getObjectWithETag` | — | typescript-pro |
| 2 | Create `web/lib/index-gen.ts` — regenerateIndex() | Task 1 (putObject) | typescript-pro |
| 3 | Create `web/lib/log-append.ts` — appendLog() | Task 1 (putObject, getObject) | typescript-pro |
| 4 | Add `invalidateSearchIndex()` to `web/lib/search.ts` | — | typescript-pro |
| 5 | Write Route Handlers: POST, PUT, DELETE | Tasks 1-4 | typescript-pro |
| 6 | Per-page URL routing (catch-all + AppShell refactor) | — | typescript-pro |
| 7 | Wire Editor to real write endpoints | Tasks 5, 6 | typescript-pro |
| 8 | Starred documents (PATCH endpoint + UI) | Tasks 1, 5 | typescript-pro |
| 9 | Mock audit and removal | Tasks 6-8 | typescript-pro |
| 10 | Build verification and integration fixes | All above | typescript-pro |

Tasks 1-4 are independent and can run in parallel.
Task 6 is independent of Tasks 1-5 (routing refactor doesn't need write ops).
