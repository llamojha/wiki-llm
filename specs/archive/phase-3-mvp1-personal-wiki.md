# Phase 3 — MVP 1 (Personal Wiki)

## Goal

Make Vaultmark a complete personal wiki: users can create, edit, and delete pages with full data integrity and a polished Markdown experience.

## Vision

A single user manages their entire knowledge base through the portal — writing pages, seeing them indexed instantly, and trusting that S3 is the durable source of truth with no data loss from concurrent edits.

## Objective

Implement the write path with optimistic concurrency, frontmatter-driven metadata, automatic index/log maintenance, and production-grade Markdown rendering.

## Acceptance Criteria

1. User can create a new page via the Editor; it is written to S3 under `wiki/` with correct frontmatter and `source_type = authored`.
2. User can edit an existing page; S3 write uses checksum-based optimistic concurrency — a concurrent edit returns 409 Conflict.
3. User can delete a page; the document is removed from S3 and deindexed from Postgres.
4. Frontmatter is the canonical metadata source. On any mismatch between frontmatter and DB, the system reindexes from frontmatter.
5. `index.md` is regenerated automatically after every write/delete operation.
6. `log.md` is appended with a timestamped entry on every create/edit/delete event.
7. Postgres search index refreshes on every write (no stale results after save).
8. Markdown rendering supports: headings, links, images, fenced code blocks, tables, frontmatter display, and heading anchors.
9. rehype-sanitize allowlist is documented; no unreviewed tags pass through.
10. A connect-a-bucket setup guide exists with an IAM policy template.
