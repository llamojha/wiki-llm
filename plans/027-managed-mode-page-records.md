# Plan 027: Managed mode + system page-records (storage-v2)

> **Executor instructions**: This is a **design-then-build plan** — the storage
> model is adjudicated but not yet specced at implementation depth. Read
> `specs/folder-first-vault.md` §8 and `specs/storage-v2-proposal.md` fully, then
> **write an implementation spec first** (`specs/managed-mode.md`) before any
> code. Honor STOP conditions; update `plans/README.md` when done.
>
> **Drift check (run first)**: `git log --oneline -1 -- web/lib/vault-mode.ts` — confirm the two-mode model (021) is present. This plan adds a THIRD mode alongside `folders`/`provenance`.

## Status

- **Priority**: P3 (the storage-v2 evolution; folders + provenance already cover
  today's needs)
- **Effort**: L
- **Risk**: MEDIUM-HIGH — introduces a second derived store (page-records) that
  MUST use ETag-CAS, the exact hazard plans 007/008/014 addressed
- **Depends on**: plan 021 (two-mode model) — SHIPPED (PR #71). Prefer landing
  plan 026 (frontmatter `origin`) first — `managed` mode builds on that
  vocabulary.
- **Category**: architecture / storage
- **Planned at**: commit `6f2b33d`, 2026-07-05

## Why this matters

`specs/folder-first-vault.md` §8 adjudicated the storage-v2 counter-proposal:
**adopt** metadata-driven provenance, two-layer metadata, and derived views over
two structure sources — while **contesting** ID-keyed filenames (slug-named files
with a stable frontmatter `id` win, for Obsidian-syncable portability). Folders
mode shipped first as the zero-metadata path; `managed` mode is the
metadata-derived evolution — what curation / bulk-import produces, where
re-parenting a page is a **metadata edit**, not an object move. This plan
establishes that mode.

## What to design (write `specs/managed-mode.md` first)

1. **The `managed` vault mode** — a third `VaultMode` value. Tree/structure is
   **metadata-derived** (`parent_id` in a system page-record), not path-derived.
   Files stay slug-named with a stable frontmatter `id`; only a slug rename moves
   an object.
2. **Two-layer metadata.** Frontmatter stays user-owned **display** metadata
   (title, tags). A system-owned **page-record** (`_system/pages/<id>.json`) owns
   provenance/tree/audit fields the user shouldn't hand-edit. Records + any
   derived-view cache use `updateStructure`-style **ETag-CAS** (plans 007/008) —
   non-negotiable. Record this as the decisions-log amendment §8 flags:
   "frontmatter is canonical for *display* metadata; system records own provenance."
3. **User-scope / multi-tenant.** `users/<id>/` stays the tenant boundary in
   `managed`/provenance; records live per-tenant.
4. **Migration.** provenance→managed is a metadata backfill (derive records from
   existing keys); NOT part of v1 unless the spec says so.

## STOP conditions

- **STOP if any derived store (records or view cache) is written without
  ETag-CAS + retry + full-rebuild fallback** — two un-CAS'd derived stores is the
  precise corruption hazard 007/008/014 closed.
- **STOP if you introduce pure ID-keyed filenames** (`pg_01J….md`) — §8 rejects
  them for v1; portability (greppable, Obsidian-syncable) is a committed product
  value. Slug files + frontmatter `id` is the decided middle ground.
- Keep `folders` and `provenance` modes byte-identical; `managed` is additive.

## Verification

- The spec (`specs/managed-mode.md`) reviewed and merged before code.
- Then: unit tests for record CAS (concurrent re-parent can't drop an edit) and
  metadata-derived tree assembly; e2e for a re-parent = metadata-only edit (no
  object move) in a managed vault; folders/provenance regressions green.
