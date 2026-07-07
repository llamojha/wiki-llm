# Plan 026: AI curate/raw pipeline in folders mode

> **Executor instructions**: This is a **build plan** — a follow-up to the
> shipped folders mode (plan 021 / PR #71). Read `specs/folder-first-vault.md`
> §5 and §8 fully first; honor the STOP conditions below. Update
> `plans/README.md` when done.
>
> **Drift check (run first)**: `git log --oneline -1 -- web/lib/vault-mode.ts web/lib/ingest-policy.ts web/app/api/curate/` and confirm folders mode (021) is still present (`web/lib/vault-mode.ts` exists, `vaultMode()`/`ensureVaultMode()` exported). If 021 was reverted, this plan cannot start.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MEDIUM — touches the curate/raw write paths and ingest routing; the
  hazard is leaking pipeline plumbing into the user's clean folder tree
- **Depends on**: plan 021 (folders mode) — SHIPPED (PR #71)
- **Category**: feature / AI pipeline
- **Planned at**: commit `6f2b33d`, 2026-07-05

## Why this matters

Folders mode (021) shipped the zero-config on-ramp — plain folders of `.md`/`.html`
just work — but the AI **curation pipeline** (raw sources → LLM → curated pages)
was deliberately deferred. Today, enabling `FEATURE_CURATE`/raw-upload in a
folders-mode vault has no coherent home for `raw/`/`generated/` artifacts. The
maintainer's decision (recorded on PR #71): **no errors on upload, no hidden
`_canopy/` subtree** — instead, **provenance lives in frontmatter, not
folders**. This plan converts the curate write path to that model so curation
works in folders mode without magic roots.

## Current state (what 021 left in place)

- `web/lib/vault-mode.ts` — `vaultMode()`/`ensureVaultMode()`; folders mode is
  sniffed/explicit.
- Plain upload (`destination=authored`) and the editor already write to the
  chosen folder path directly in folders mode, with `source_type`/`origin` in
  frontmatter (`web/app/api/upload/route.ts`, `web/app/api/docs/route.ts`).
- `regenerateMasterIndex` routes to a folders-mode flat catalog; per-space
  indexes are skipped in folders mode (`web/lib/index-gen.ts`).
- The curate pipeline (`web/app/api/curate/*`, `web/infra/lambda/curate/`,
  `web/lib/ingest-policy.ts`) is **still provenance-shaped** — it composes
  `raw/` inputs and `generated/<space>/` outputs.
- Upload's `raw` destination is guarded by `FEATURE_CURATE` (off by default), so
  nothing errors in the default deployment today.

## What to build

1. **Raw inputs, folders mode.** Decide where raw pipeline *inputs* live. Per the
   maintainer decision (no hidden subtree), inputs are ordinary user-visible
   files the user points curation at — a user-chosen source folder, not a magic
   `raw/` root. The curate "start" flow takes an explicit source location.
2. **Generated outputs → frontmatter provenance.** Curated pages land in a
   **user-chosen destination folder** as normal `.md`, with `origin: generated`
   (and any pipeline audit fields) in **frontmatter**, not a `generated/<space>/`
   path. Define the `origin` vocabulary from §8:
   `origin: 'authored' | 'generated' | 'uploaded' | 'imported'`, default
   `authored`. Read sites already prefer frontmatter (`fmStringOr(fm.source_type, …)`).
3. **Ingest routing** (`web/lib/ingest-policy.ts`) gains a folders-mode branch:
   route by the caller-chosen destination folder + frontmatter origin, not the
   provenance roots.
4. **Curate routes** (`web/app/api/curate/{start,finalize,status,cancel}`) and the
   **curate Lambda** (`web/infra/lambda/curate/`) thread the folders-mode
   destination through; finalize does a full folders master-index rebuild
   (`regenerateMasterIndex` already branches) + search invalidation.
5. **Tests**: unit for the `origin` frontmatter round-trip and folders-mode
   ingest routing; e2e for curate start→finalize in a folders vault producing a
   page in the chosen folder with `origin: generated` (no `generated/` root, no
   `_canopy/`).

## STOP conditions

- **STOP if you find yourself creating a hidden `_canopy/` subtree or a magic
  top-level `generated/`/`raw/` folder** — the maintainer explicitly rejected
  both. Provenance is a frontmatter value in folders mode.
- **STOP before touching provenance-mode curate behavior** — it must stay
  byte-identical; branch on `vaultMode()`, don't rewrite the shared path.
- The curate Lambda deploys out-of-band; note in the PR that a redeploy is
  required (mirror plan 008's note).

## Verification

- `pnpm typecheck && pnpm test:unit && VAULT_BUCKET=mock-bucket pnpm build && pnpm test:e2e`.
- New e2e: folders vault, `FEATURE_CURATE=on`, curate a source doc → assert the
  generated page lands in the chosen folder with `origin: generated` frontmatter
  and shows in the tree/search. Provenance curate e2e stays green.
