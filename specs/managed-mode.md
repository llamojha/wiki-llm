# Managed vault mode (metadata-derived tree) — v1

> **Status**: DESIGN → IMPLEMENTING (2026-07-06, branch `feat/managed-vault-mode`).
> This is the implementation spec plan 027 mandates before any code. It builds on
> [`folder-first-vault.md`](folder-first-vault.md) §8 (the storage-v2 adjudication)
> and [`storage-v2-proposal.md`](storage-v2-proposal.md), and **amends** one §8
> decision — see [Decisions-log amendment](#decisions-log-amendment). Managed mode
> is a **third** `VaultMode` alongside `folders` and `provenance`; those two stay
> byte-identical (`managed` is purely additive).

## Problem

`folders` and `provenance` modes are both **path-derived**: a page's position in
the tree *is* its S3 key. Moving a page in the tree therefore requires physically
moving (copy + delete) the S3 object — and any `assets/` bound to the old path
break. `folder-first-vault.md` §8 adjudicated a Confluence-style counter-proposal
(`storage-v2-proposal.md`) and adopted a **metadata-derived** structure source as
the storage-v2 evolution: files stay slug-named with a stable frontmatter `id`,
the tree edge lives in a frontmatter `parent_id`, and **re-parenting a page is a
one-file metadata edit, not an object move**. This spec designs that mode.

## 1. Mode definition

`managed` is a vault mode where **the page tree is derived from frontmatter
`parent_id`**, not from the S3 key path. Compared with the other two modes:

| | `provenance` | `folders` | `managed` |
|---|---|---|---|
| Tree source | `structure.json` + provenance roots | S3 key path | frontmatter `parent_id` (path fallback) |
| Re-parent | object move | object move | **metadata edit (no move)** |
| Provenance | `generated/`/`authored/` roots | `origin` frontmatter | `origin` frontmatter |
| Recognition | docs under content roots | any `.md` outside `_system/`/`raw/` | any `.md` outside `_system/`/`raw/` |
| Tenant boundary | `users/<id>/` | single-tenant | `users/<id>/` |

Managed mode is a **superset of folders mode**: it recognizes the same keys and
falls back to the same path-derived tree when a page has no `parent_id`. The only
thing it adds is the `parent_id` edge (and the stable `id` it references).

## 2. Resolution + sniff

Resolution order (highest wins), extending `web/lib/vault-mode.ts`:

1. Explicit `VAULT_MODE=managed|folders|provenance`.
2. Sniff:
   - **managed** — the marker object `_system/managed.json` exists.
   - **provenance** — `_system/structure.json` exists, or any
     `generated/`/`authored/` (or `users/*/generated|authored/`) key is present.
   - else **folders**.
3. Default `folders`.

Managed is sniffed by an **explicit marker** (`_system/managed.json`) rather than
by content, because managed and folders recognize the *same* keys — there is no
content-shape signal that distinguishes them. The marker is written by the
reconcile/migration step (§8) when a vault is promoted to managed. Log the
resolved mode once at startup (`[vault] mode=managed (env|sniffed)`), mirroring
the existing `folders`/`provenance` line.

## 3. S3 layout

```text
s3://bucket/<prefix>/
  pages/
    <space>/
      <slug>.md            # slug-named; frontmatter carries id + parent_id
  assets/
    <id>/                  # attachments bound to a page by its stable id
  raw/                     # curate scratch inbox (only if curate is opted in)
  _system/
    managed.json           # mode marker
    index.md               # derived, human/agent-readable (as today)
```

- Files are **slug-named** (`pages/wiki/lambda-curate-pipeline.md`). Only a **slug
  rename** moves an object. **No pure ID-keyed filenames** (`pg_01J….md`) — §8
  rejects them; the bucket stays greppable and Obsidian-syncable.
- `assets/<id>/` binds attachments by the stable frontmatter `id`, so a slug
  rename or re-parent never orphans them.
- Out-of-band files (dropped via `aws s3 sync`, an Obsidian folder) need not live
  under `pages/` — recognition is path-agnostic (§5). `pages/<space>/` is the
  convention the portal *writes*, not a recognition requirement.

## 4. Frontmatter schema

Frontmatter is the **single source of truth** for all page metadata:

```yaml
---
id: pg_01JAAA              # stable page id (pg_ + monotonic/ULID). Immutable.
title: Lambda Curate Pipeline
space: wiki                # top-level grouping; matches FOLDER_SEGMENT_RE
slug: lambda-curate-pipeline
parent_id: pg_01JPLAT      # tree edge; null/absent → path-derived fallback (§6)
status: published          # published | draft
labels: [aws, lambda]      # optional
origin: generated          # 026 vocabulary: authored|generated|uploaded|imported
---
```

- `id` is immutable once assigned; it is the join key for `parent_id` references
  and `assets/<id>/`.
- All fields except `id`/`title` are optional; defaults are applied at read time
  (`origin` → `DEFAULT_ORIGIN` via `web/lib/origin.ts`; `status` → `published`;
  `parent_id` → path fallback). See §6.

## 5. Document recognition

In `managed` mode `isDocumentKey(key)` is **identical to folders mode**: any
`.md` outside the reserved namespaces. It MUST keep folders' exclusions:

| Excluded | Why |
|---|---|
| `_system/**` | system state — never user content |
| `raw/**`, `users/*/raw/**` | curate scratch inputs — un-curated uploads must not leak into sidebar/search |
| `.keep` | empty-folder markers |
| non-`.md` | `.md`-only recognition in v1 (`.html` is folders/022's surface) |

**Provenance is a frontmatter badge, never a reason to hide.** AI-generated pages
live as ordinary `.md` under `pages/<space>/` with `origin: generated`; they
appear in the tree, badged — they are first-class pages. Only `raw/` (scratch
*inputs* to curation) is hidden.

## 6. Tree assembly (live, no cache in v1)

The tree is assembled **live, per request**, from the recognized keys + their
parsed frontmatter — exactly as folders mode assembles from paths today. There is
**no persistent `_system/views/*.json` cache in v1** (see §9 for why, and the
deferred follow-up).

Edge resolution, per page:

1. If frontmatter `parent_id` is present and resolves to another recognized
   page's `id` → nest under that page.
2. Else if `parent_id` is present but **does not resolve** (dangling) → treat as
   an orphan at the space root (an Inbox-style root node).
3. Else (`parent_id` absent/null) → **path-derived fallback**: nest by the S3 key
   path segments, identical to folders mode. A freshly-synced Obsidian vault with
   real folders looks correct immediately.

A **cycle guard** breaks any `parent_id` loop by treating the offending node as a
root (never infinite-loop the assembly).

## 7. Auto-adopt out-of-band files

A file dropped via `aws s3 sync` / an Obsidian export may carry **no managed
frontmatter** (no `id`, no `parent_id`). Managed mode adopts it without requiring
a write on the read path:

- **Missing `id`** → a **deterministic fallback id derived from the S3 key**
  (stable across renders, e.g. `pgk_<hash(key)>`), so `parent_id` references,
  `assets/` binding, and tree keys are stable until a reconcile backfills a real
  `pg_…` id.
- **Missing `parent_id`** → path-derived placement (§6.3).

This means a synced plain-Markdown file is **visible immediately** (live
assembly), just placed by its path — no reconcile required to see it. Reconcile
(§8) *promotes* it into a fully-tracked managed page (real `id`, explicit
`parent_id`) on demand.

## 8. Reconcile / backfill + migration

A single idempotent, dry-run-capable operation (`web/lib/managed-reconcile.ts`,
exposed via a gated route or script) serves two jobs:

1. **Adopt out-of-band files** — for any recognized page missing `id`/`parent_id`,
   write real frontmatter (assign `pg_…`, set `parent_id` from the path fallback
   or `null`), leaving the object key unchanged (unless a slug normalization is
   required).
2. **provenance→managed migration** — derive `origin` from the provenance roots,
   assign ids, set `parent_id` from the existing path hierarchy, move objects into
   `pages/<space>/`, and write the `_system/managed.json` marker.

Reconcile is **only invoked explicitly**; it never runs implicitly and never
touches a `folders`/`provenance` vault unless called. Re-running it is a no-op
(pages that already have `id`/`parent_id` are skipped).

## 9. Concurrency & the STOP conditions

- **No second derived store in v1.** Because the tree is assembled live from
  frontmatter and there is no persistent cache, v1 introduces **no** second
  derived store. The individual `.md` file is the only written artifact on the
  page write path, and it uses the **existing editor ETag concurrency** (the
  `web/app/api/docs` PUT CAS). This sidesteps the MEDIUM-HIGH hazard plans
  007/008/014 addressed.
- **Future cache is CAS-gated.** A persistent `_system/views/*.json` tree cache is
  a deferred follow-up. If/when added it **MUST** use ETag-CAS + retry +
  full-rebuild fallback (the `web/lib/vault-structure.ts` `updateStructure`
  pattern). This is a hard STOP condition — a second un-CAS'd derived store is the
  exact corruption hazard those plans closed.
- **No pure ID-keyed filenames.** Slug files + frontmatter `id` only. A slug
  rename is the only operation that moves an object. STOP if `pg_….md` filenames
  are introduced.
- **Additive only.** `folders` and `provenance` modes stay byte-identical.

## Decisions-log amendment

`folder-first-vault.md` §8 said: *"a system-owned page record
(`_system/pages/<id>.json`, ETag-CAS) owns provenance/tree/audit fields the user
shouldn't hand-edit … frontmatter is canonical for display metadata; system
records own provenance."*

**This spec amends that decision** (maintainer-approved, 2026-07-06):

> **Frontmatter is canonical for *all* page metadata, including provenance
> (`origin`) and tree position (`parent_id`).** There is **no independent
> page-record store** in managed mode v1. Any derived artifact (a future tree/
> search cache) is a rebuildable cache over frontmatter, not a source of truth,
> and must be ETag-CAS'd if persisted.

Rationale: (a) a single source of truth is a simpler, sturdier failure model —
a lost/corrupt cache is never data loss; (b) it honors the product's "no
lock-in / Obsidian-syncable" value — a user drops a `.md` and it works, with no
requirement to also upload/maintain a sidecar `.json`; (c) it removes the second
un-CAS'd-store hazard from v1 entirely. Flag for the decisions log.

## Test matrix

- **Mode resolution** — explicit `managed`; sniff by `_system/managed.json`;
  folders/provenance resolution unchanged beneath.
- **Recognition** — `pages/wiki/foo.md` and a synced `notes/bar.md` recognized;
  `raw/src/x.md`, `users/u/raw/y.md`, `_system/z.md`, `.keep` excluded.
- **Frontmatter** — round-trip; `id` stability; deterministic fallback-id;
  defaults (`origin`/`status`/`parent_id`).
- **Tree assembly** — `parent_id` nesting; dangling `parent_id` → orphan;
  absent `parent_id` → path fallback; cycle rejection; mixed adopted/tracked.
- **Create/edit** — create assigns `id` + appears in tree; edit preserves `id`.
- **Re-parent** — object key unchanged after re-parent; tree reflects new edge;
  cycle rejected.
- **Reconcile** — provenance fixture → managed; plain synced file adopted;
  re-run is a no-op; folders/provenance vaults untouched unless invoked.
- **Regressions** — folders/provenance unit + e2e suites stay green.

## Deferred follow-ups (NOT in v1)

- Persistent `_system/views/*.json` tree cache with ETag-CAS (add on measured
  need; the risk surface lives here).
- AI curate pipeline writing into managed mode (026 covered folders).
- Confluence import; review-queue/drafts UX; events-as-truth log.
