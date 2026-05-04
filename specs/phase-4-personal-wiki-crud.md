# Phase 4 — Personal Wiki CRUD

**Milestone:** MVP 2 (with Phase 5)

## Goal

Make Vaultmark a complete personal wiki: users can create, edit, and delete pages through the portal with full data integrity.

## Vision

A user writes and manages their knowledge base through the browser — creating pages, editing them, and trusting that concurrent edits won't silently overwrite each other.

## Objective

Build the user-facing write path as Next.js Route Handlers. Add S3 optimistic concurrency, wire the Editor to real writes, and implement immediate `index.md` regeneration.

## Architecture

Write endpoints live alongside the existing read endpoints:

```
web/app/api/docs/
├── [...id]/route.ts      GET (existing) + PUT + DELETE
└── route.ts              POST (create new doc)
```

Write operations use `lib/s3.ts` (extended with `putObject` and `deleteObject`) and a new `lib/index-gen.ts` for `index.md` regeneration.

## Key Decisions

- **Route Handlers, not a separate backend** — writes go through the same Next.js app.
- **S3 checksum concurrency** — PUT sends `If-Match` with the doc's current ETag. S3 returns 412 on mismatch → API returns 409 to the client.
- **Immediate index regen** — user writes trigger immediate `index.md` regeneration (single operations are cheap).
- **Search index invalidation** — after a write, the in-memory Fuse.js index is cleared and rebuilds on next search request.
- **No Postgres** — all state lives in S3. Search is in-memory.
- **No tags** — discoverability is handled by search indexing, not manual tagging.
- **Frontmatter is canonical** — `source_type`, `title`, `author`, `updated` are set in frontmatter on every write.

## Acceptance Criteria

1. `POST /api/docs` creates a new page in S3 with correct frontmatter and `source_type = authored`.
2. `PUT /api/docs/:id` updates an existing page. Uses S3 ETag-based optimistic concurrency — concurrent edit returns 409.
3. `DELETE /api/docs/:id` removes the document from S3.
4. `index.md` is regenerated immediately after every create/delete.
5. `log.md` is appended on every create/edit/delete event.
6. In-memory search index is invalidated on write (rebuilds lazily on next search).
7. Editor component is wired to real write endpoints (mock removed).
8. `rehype-sanitize` allowlist is documented; no unreviewed tags pass through.
9. Markdown rendering supports: headings, links, images, fenced code blocks, tables, frontmatter display, heading anchors.
10. User can maintain at least 200 pages comfortably.
