# Phase 4 — Personal Wiki CRUD

**Milestone:** MVP 2 (with Phase 5)

## Goal

Make Vaultmark a complete personal wiki: users can create, edit, and delete pages through the portal with full data integrity.

## Vision

A user writes and manages their knowledge base through the browser — creating pages, editing them, and trusting that concurrent edits won't silently overwrite each other.

## Objective

Build the user-facing write path on top of Phase 3's write infrastructure. Add optimistic concurrency, wire the Editor to real S3 writes, and implement immediate index regeneration for interactive use.

## Key Decisions

- **Builds on Phase 3 write layer** — S3 PutObject and index regen already exist from the ingest pipeline. This phase adds checksum-based optimistic concurrency and the user-facing Editor.
- **Immediate index regen** — unlike Phase 3's batch approach, user writes trigger immediate `index.md` regeneration (single operations are cheap).
- **Hierarchical `index.md`** — root + per-folder structure, designed in Phase 3, used here for nav after writes.
- **No tags** — discoverability is handled by search indexing, not manual tagging.
- **Frontmatter is canonical** — when frontmatter and DB disagree, reindex from frontmatter.

## Acceptance Criteria

1. User can create a new page via the Editor; it is written to S3 under `wiki/` with correct frontmatter and `source_type = authored`.
2. User can edit an existing page; S3 write uses checksum-based optimistic concurrency — a concurrent edit returns 409 Conflict.
3. User can delete a page; the document is removed from S3 and deindexed from Postgres.
4. Frontmatter is the canonical metadata source. On any mismatch between frontmatter and DB, the system reindexes from frontmatter.
5. `index.md` (root + per-folder) is regenerated immediately after every create/delete operation.
6. `log.md` is appended on every create/edit/delete event.
7. Postgres search index refreshes on every write (no stale results after save).
8. Markdown rendering supports: headings, links, images, fenced code blocks, tables, frontmatter display, and heading anchors.
9. rehype-sanitize allowlist is documented; no unreviewed tags pass through.
10. User can maintain at least 100 Markdown pages comfortably.
11. Editor mock is fully replaced with real S3-backed writes.
