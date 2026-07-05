# Folder-first vault mode

> **Status**: IMPLEMENTED (2026-07-05, branch `feat/folders-first-vault-mode`).
> The minimal folders mode shipped: mode resolution (`web/lib/vault-mode.ts`),
> mode-aware recognition, folders tree/index/search, folder-direct write paths,
> and the scope-toggle hide. **Deferred to follow-ups**: the AI curate/raw
> pipeline in folders mode (§5) and `managed` mode + system page-records (§8).
> This spec also adjudicates [`storage-v2-proposal.md`](storage-v2-proposal.md)
> (§8) per the 2026-07-04 scope amendment.

## Problem

The vault layout is **provenance-first**: documents must live under
`generated/<space>/`, `authored/<space>/`, or the per-user mirrors
(`users/<id>/…`). That layout exists to serve the AI curation pipeline. But the
default deployment ships curate/upload/editor **off** (browse + agent only —
`web/lib/flags.ts`), and `isDocumentKey` (`web/lib/vault-paths.ts`) returns
`false` for anything outside the provenance roots. So the most common on-ramp
imaginable — *"point Vaultmark at my existing folder of Markdown notes"* —
renders an **empty portal**: `notes/foo.md` is not recognized as a document.

The maintainer wants **folder-first to be the default**: plain folders of
Markdown just work, and the raw→generated→authored AI pipeline becomes an
opt-in layer on top. This spec designs that without breaking existing
provenance vaults.

## 1. Modes

Introduce a vault **mode**: `'folders' | 'provenance'`.

Resolution order (highest wins):

1. Explicit `VAULT_MODE=folders|provenance` env var.
2. Sniff: if `_system/structure.json` exists **or** any `generated/` /
   `authored/` key is present ⇒ `provenance`; else ⇒ `folders`.
3. Default: `folders`.

**Decision — explicit with sniffed fallback.** Pure sniffing is surprising
(adding one `generated/` key silently flips a vault's semantics); explicit-only
defeats the zero-config on-ramp. So: sniff for a good default, but always allow
an explicit override, and **log the resolved mode once at startup** — mirroring
the existing `[s3] runtime config …` line (`web/lib/s3.ts`). A `[vault] mode=folders (sniffed)`
line makes "why is my portal empty/full?" a one-glance answer.

The mode is resolved once at module load (like the S3 config) and exposed as
`vaultMode(): 'folders' | 'provenance'`.

## 2. Document recognition

In **folders** mode, `isDocumentKey(key)` ≈ *"any `.md` not under `_system/`
and not a reserved filename."*

Reserved / excluded set:

| Excluded | Why |
|---|---|
| `_system/**` | system state (index, log, structure, proposals) — never user content |
| `*.keep` | empty-folder markers (plan 015) |
| non-`.md` (`.css`, `.html`†, images) | `.md`-only recognition in v1; `.html` is plan 022's job |
| `raw/**`, `generated/**` (if present) | if a folders-mode vault later opts into the pipeline, those stay pipeline-owned (see §5) |

† `index.md` / `log.md` at a folder root are **not** reserved in folders mode —
a user may legitimately have a `README`-style `index.md`. The reserved system
files live under `_system/` only; the legacy root `index.md`/`log.md` belong to
provenance mode.

`source_type`: **frontmatter wins, fallback `authored`.** A folders-mode doc
with no `source_type` frontmatter is `authored` (it's user-written content).
Do not introduce a new `'file'` value — it would ripple through `DocSummary`,
search, and the UI for no user-visible gain; `authored` already means
"a human wrote this."

## 3. Tree & indexing

- **Folder tree = the actual S3 key tree.** One prefix-wide
  `listAllKeys()` (or the `.md`-filtered `listObjects()`), bucketed in memory
  by path segments — exactly the shape `folders.ts::listFolderTree` already
  uses and the direction plans **012** (parallel/prefix-wide listing) and
  **014** (incremental index) push toward. No per-space double-LIST.
- **`structure.json` is not used in folders mode.** The top-level folders
  **are** the spaces; there is no separate declaration to keep in sync. This
  removes an entire class of drift (declared-but-empty spaces, rename CAS)
  from the common case.
- **`_system/` is still written** (recommended). The agent's catalog
  (`index.md`) and the audit log stay useful and unchanged in shape; only their
  *inputs* differ (all recognized `.md` vs the provenance walk). Keeping
  `_system/` identical means the agent, search, and reindex paths converge on
  one code path across modes.

## 4. Write paths

- Editor / upload in folders mode write to the **user-chosen folder path
  directly** (`<folder>/<slug>.md`), no `authored/<space>/` prefixing.
- Folder CRUD reuses plan **015**'s `movePrefix` / `purgePrefix` /
  `prefixHasObjects` on arbitrary prefixes — they are already
  provenance-agnostic (they operate on raw prefixes), so folders mode is a
  caller change, not a vault-ops change.
- **Personal space / `users/` tree**: **does not exist in folders mode**
  (single-user). Consequence: the sidebar **scope toggle** (Shared / My) is
  hidden in folders mode — there is one tree, the folder tree. Multi-tenant
  folders-mode is a Phase 6 question (see §8 open items), not v1.

## 5. AI pipeline opt-in

Turning `FEATURE_CURATE` / raw-upload **on** in a folders-mode vault needs a
home for `raw/` and `generated/`. Options:

| Option | Verdict |
|---|---|
| (a) Refuse — require switching to provenance mode | viable, simplest to reason about |
| (b) Reserved `_vaultmark/` subtree for pipeline artifacts | **recommended** |
| (c) `raw/`/`generated/` appear alongside user folders | rejected — recreates today's confusion (user sees pipeline plumbing as "folders") |

**Recommendation: (b), with (a) as the honest fallback.** Pipeline inputs land
in `_vaultmark/raw/`, generated pages in `_vaultmark/generated/<space>/`, and
curation *promotes* an approved page into the user's chosen folder as a normal
`.md`. This keeps the user's folder tree clean (only their content) while the
pipeline has a private scratch area, symmetric with `_system/`. If (b) proves
too invasive for the first implementation, ship (a): a clear error —
*"AI curation requires provenance mode; set `VAULT_MODE=provenance`"* — is
better than leaking `raw/` into the user's tree.

## 6. Migration & coexistence

- Existing provenance vaults are **detected and unchanged** (sniff → `provenance`).
  Zero migration, zero behavior change — the e2e suite (which seeds provenance
  keys) stays green with `VAULT_MODE` unset.
- A folders→provenance (or reverse) **converter is out of scope for v1**. The
  two modes coexist by detection; conversion is a follow-up if demand appears.

## 7. Touch list

From the Step-1 recon (`grep` over `generated/|authored/|rawPrefix|*_ROOT`;
56 hits across 14 files). Effort is for the *folders-mode branch*, not a rewrite.

| Module | Provenance assumption | Folders-mode need | Effort |
|---|---|---|---|
| `web/lib/vault-paths.ts` | `isDocumentKey`, `sourceTypeFromKey`, `*Prefix` builders assume the roots | mode-aware `isDocumentKey`; `sourceTypeFromKey`→`authored` fallback | **M** — single recognition function is the linchpin |
| `web/lib/scope.ts` | `resolveScope`/`inferScopeFromKey` key off provenance roots + `users/` | folders mode: one implicit scope, no `users/` | M |
| `web/lib/vault-structure.ts` | `structure.json` is authoritative for spaces | folders mode ignores it; tree is spaces | S (bypass, don't rewrite) |
| `web/lib/vault-tree.ts` | walks personal+user+shared spaces | folders mode: bucket the raw key tree | M (reuses `listFolderTree` shape) |
| `web/lib/index-gen.ts` | per-space two-prefix listing | folders mode: list recognized `.md`, group by top folder | M |
| `web/lib/search.ts` | `buildIndex` filters by `isDocumentKey` | inherits mode-aware `isDocumentKey` — **free once vault-paths lands** | S |
| `web/lib/folders.ts` | top-level = space (declared); nested = prefix | folders mode: all folders are prefixes (already the nested path) | S |
| `web/lib/agent-tools.ts` / `agent-prompts.ts` | scope-check + catalog prompt assume roots | folders mode: scope is trivial; prompt unchanged (reads `_system/index.md`) | S |
| `web/lib/ingest-policy.ts` | pipeline routing | only relevant when pipeline opt-in (§5) | S (deferred with §5) |
| `web/app/api/upload/route.ts` | composes `authored/<space>/` keys | folders mode: write to chosen path | S |
| `web/app/api/reindex`, `curate/start`, `raw` | provenance-scoped | reindex works via mode-aware recognition; curate/raw gated to pipeline opt-in | S–M |
| `web/lib/types.ts` | `source_type` union | no change (reuse `authored`) | — |

**Linchpin**: a single mode-aware `isDocumentKey` (and the tree builder) carry
most of the behavior; search/agent inherit it for free. Land that + the tree +
upload path for a minimal folders-mode; the pipeline opt-in (§5) is a separable
second implementation plan.

## 8. Storage-v2 adjudication

Reading [`storage-v2-proposal.md`](storage-v2-proposal.md) (a Confluence-model
counter-proposal: metadata-driven provenance, ID-keyed pages, derived views,
events-as-truth). Verdict on each contested point:

- **Structure source — path-derived vs `parent_id` frontmatter.**
  **Adopt the two-mode synthesis.** One *derived-view/tree layer* over two
  structure sources: `folders` mode (path-derived — the zero-metadata on-ramp,
  this spec's §3) and a future `managed` mode (metadata-derived — what curation
  / bulk-import produces, where re-parenting is a metadata edit). Folders mode
  ships first; `managed` mode is the storage-v2 evolution, not a competitor.
- **File naming — readable slug keys vs ID keys (`pg_01J….md`).**
  **Slug-named files with a stable `id` in frontmatter** is the recommended
  middle ground: the bucket stays greppable and Obsidian-syncable (a hard
  product value — "no lock-in"), tree position comes from metadata in `managed`
  mode (re-parent = metadata-only), and **only a slug rename moves an object**.
  Pure ID keys are rejected for v1 — they break the portability the philosophy
  doc commits to.
- **Provenance — metadata-driven vs `generated/`/`authored/` folders.**
  **Adopt metadata-driven provenance.** The audit evidence is strong: the
  provenance folders are the root cause of the empty-portal problem, the
  `.keep`-sweep hacks (fixed in 015), and the space-declaration drift. Define
  the vocabulary against today's `source_type`:
  `origin: 'authored' | 'generated' | 'uploaded' | 'imported'` in frontmatter,
  defaulting to `authored`. `generated`/`authored` become **frontmatter values,
  not folders**.
- **Two-layer metadata — frontmatter vs system page-records.**
  **Adopt, and record it as an explicit decisions-log amendment.** Frontmatter
  stays user-owned display metadata (title, tags — "frontmatter is canonical"
  for *those*); a system-owned page record (`_system/pages/<id>.json`, ETag-CAS
  per plans 007/008) owns provenance/tree/audit fields the user shouldn't hand-
  edit. This **amends** "frontmatter is canonical metadata" → "frontmatter is
  canonical for *display* metadata; system records own provenance." Flag for
  the decisions log.
- **Must-answer, unaddressed by the proposal:**
  - *User-scope / multi-tenant layout.* Keep `users/<id>/` as the tenant
    boundary in `managed`/provenance modes; folders-mode is single-tenant (§4).
    Records live per-tenant.
  - *Migration.* Existing provenance vaults detected & untouched (§6);
    provenance→managed is a metadata-backfill follow-up, not v1.
  - *ETag CAS on records/views.* Records and any derived-view cache use the
    plans 007/008 `updateStructure`-style compare-and-swap. Non-negotiable —
    two derived stores without CAS is the exact hazard 007/008/014 addressed.
- **Explicitly out of adopted v1** (re-decide separately): Confluence import,
  review-queue UX, PDF sources — all on the ROADMAP out-of-scope list.

## 9. Open questions for the maintainer

1. **`_vaultmark/` vs refuse for pipeline opt-in (§5).** Recommend `_vaultmark/`
   subtree; accept "refuse + require provenance mode" as the v1 shortcut if the
   subtree is too much for the first cut. *Which for v1?*
2. **Does folders mode need `_system/index.md` at all, or can the agent read the
   live tree directly?** Recommend keep `_system/` for one converged code path;
   revisit if the agent's 1M context makes the cached catalog redundant.
3. **`managed` mode in this spec or its own?** Recommend: this spec establishes
   the two-mode *model* (§8); `managed` mode gets its own implementation spec so
   folders-mode isn't blocked on the records layer.
4. **Reserved root files (`index.md`, `log.md`) in folders mode** — treat as
   normal user docs (recommended) or keep reserved for back-comat? Recommend
   normal; `_system/` is the only reserved namespace.
5. **Scope toggle in folders mode** — hide entirely (recommended, §4) or show a
   disabled hint? Recommend hide.

## PRD deltas

Re-read PRD §12 (vault files) and §16 (open questions): **nothing mandates the
provenance layout.** §12 lists `AGENTS.md`/`INDEX.md`/`LOG.md` etc. as *vault
content* (mode-agnostic); the data-model section commits to Markdown-in-S3,
frontmatter-canonical, and portability — all of which folders mode **honors
better** than provenance mode. The one convention this spec amends is
"frontmatter is canonical metadata" → scoped to *display* metadata once system
page-records land (§8). No PRD conflict; log the metadata-scope amendment.

## Spike findings (couplings, from code inspection)

The design rests on "one prefix-wide list serves tree+index+search for a plain
vault." Couplings that a `VAULT_MODE=folders` read-only spike must handle
(identified by inspection; verify when implementing):

- `displayPathForKey` (`vault-paths.ts`) strips provenance roots to build
  breadcrumbs — in folders mode the key *is* the display path; the strip must
  no-op.
- `sourceTypeFromKey` returns based on the root segment — folders mode must
  fall back to `authored` (not throw / not return empty).
- The doc-reader route (`GET /api/docs/[...id]`) gates on `isDocumentKey` —
  mode-aware recognition fixes it centrally (do NOT special-case the route).
- `inferScopeFromKey` keys off `users/` — folders mode has no `users/`; it must
  return the single implicit scope, not misclassify.

These four are the whole coupling surface; all resolve through the mode-aware
recognition/scope functions, not scattered route edits.

## Test matrix (for the implementation plan)

Mode detection (explicit/ sniff/ default); mixed trees (folders + a stray
`_system/`); reserved-name exclusion; deep nesting; non-ASCII folder names;
provenance vault unchanged with `VAULT_MODE` unset; folders→pipeline opt-in
(§5) once that ships.
