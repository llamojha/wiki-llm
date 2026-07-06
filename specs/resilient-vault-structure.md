# Resilient Vault Structure

**Status:** Planned, ready to implement
**Scope:** `structure.json` as a validated, versioned, concurrency-safe control plane co-edited by the human and the AI curator. True multi-space runtime. (Spec 1 of 2; Spec 2 — HTML documents & themed reports — is deferred and will add fields to this schema later.)

## Problem

`structure.json` is the vault's control plane, edited by two independent writers — the human (direct edit / future UI) and the AI curator (`ensureSpaceInStructure` on the web `web/lib/ingest` path, and routing on the Lambda path). It has none of the guarantees a shared, concurrently-edited contract needs:

- **No validated schema.** Any shape is accepted; a typo in `generated` or a missing `spaces` array passes unnoticed.
- **No concurrency control.** Human and AI can write simultaneously; `putStructure` blind-overwrites, last write wins and silently clobbers.
- **Silent failure.** `getStructure()` swallows every error and returns `spaces: []`, so a malformed or missing file is indistinguishable from an empty vault. No signal, no recovery.
- **Schema/runtime divergence.** The schema models multiple generated spaces, per-space flags, a (now-deleted) `folders` block, and `users[]`; the runtime honors one generated space (`findIngestSpace` returns the first match; `/api/raw` and `/api/synthesize` reject the rest).
- **No provenance.** AI-created and human-created spaces are indistinguishable, so the human can't review/protect what the AI touched and the two writers can fight over the same fields.

Every past incident traces to this single root cause (an unvalidated, silently-failing file edited by two parties without a contract):
- 2026-06-06 multi-space routing bug — "structure.json says multi-space, code forced everything to `wiki/`."
- The flat `generated/wiki/sources/` dump — a `folders` capability declared but never implemented, later deleted.
- Dangling `[[wikilinks]]` — synthesis (curation-pipeline tasks 4/5) declared in intent, never built.
- The two writers (Lambda `getGeneratedSpaces` vs web `ensureSpaceInStructure`) drift with no shared validation.

## Goal

Make `structure.json` an honest, validated, versioned, concurrency-safe contract owned by one module, with an explicit additive AI-writable surface and loud, recoverable failures — and make the runtime honor what the schema declares (true multi-space), so the AI can create structure as it generates articles while the human stays in control.

## Design

### 1. Single schema owner (pure module)
- New `web/lib/vault-structure/schema.ts` exporting `validateStructure(raw: unknown): { ok: true; value: VaultStructure } | { ok: false; errors: string[] }` and `migrateStructure(raw: unknown): VaultStructure`.
- Hand-rolled validator (no new dependency — repo has no zod/ajv; the curate Lambda is npm and outside the pnpm workspace, so a copyable pure-function validator avoids a shared-dependency bump and keeps web↔Lambda parity simple).
- Extend `SpaceEntry` with optional provenance/control fields: `createdBy?: 'user' | 'ai'`, `locked?: boolean`, `createdAt?: string`, `updatedAt?: string`.

### 2. Resilient read
- Rework `getStructure()`: fetch-with-ETag → `validateStructure` → on success cache `{ value, etag }`.
- Not-found on first run → write `DEFAULT_STRUCTURE` and return it (fine).
- Malformed/invalid → log loudly, return last-known-good cache if present, else a minimal default flagged `degraded: true`. NEVER silently return empty.
- Add `getStructureHealth()` for a UI banner / health surface to distinguish "empty vault" from "broken config".

### 3. Concurrency-safe write
- `putStructure()` → read-modify-write under S3 ETag optimistic concurrency using existing `getObjectWithETag` + `putObject(key, content, etag)` + `ConcurrencyError`, with bounded retry on conflict. No blind overwrites.

### 4. Constrained AI mutation surface
- Replace `ensureSpaceInStructure` with `registerSpace(name, opts, { by: 'user' | 'ai' })`: additive, idempotent, stamps `createdBy`/`createdAt`. When `by: 'ai'` it must refuse to modify an existing space or any `locked` space (no-op / leave intact).
- Add human-side helpers `updateSpace(...)` / `setSpaceLock(...)` (`by: 'user'`).
- Append every structure mutation to `log.md` (reuse `web/lib/log-append.ts`) for audit/curation.
- This enforces the existing invariant noted in `vault-structure.ts` ("reindex may only add/remove file entries within declared spaces — it cannot create, rename, or reorganize spaces").

### 5. True multi-space runtime
- Add `getGeneratedSpaces(structure): string[]` to `web/lib/ingest-policy.ts` (name-matched to the Lambda's existing `getGeneratedSpaces`); replace the single-space `findIngestSpace`.
- Update `web/app/api/raw/route.ts` and `web/app/api/synthesize/route.ts` to accept any declared `generated: true` space (validate membership in the generated-space set; clear 4xx for undeclared spaces) instead of rejecting `space !== policy.space`.
- Trim dead `folders` references and the single-space assumption; document deterministic placement (`placementFromRawKey`, per `specs/sources-foldering.md`) as the contract.

### 6. Versioning & migration
- Enforce `version`; wire `migrateStructure` into `getStructure` (in-memory) with concurrency-safe write-back when upgrading an older shape (e.g. v1 → current: add `roots`, `defaultUser`, `users[]`).
- Reject unknown future versions loudly (treat as `degraded`).

### 7. Editor & CLI ergonomics
- Emit `structure.schema.json` (JSON Schema) so the file gets editor autocomplete/validation via `$schema`.
- Add `docs/structure-schema.md` documenting the schema, the AI-writable surface, and invariants.
- Add `ingest` CLI commands (`ingest/src/commands/`): `structure validate`, `structure init`, `structure add-space`.

### 8. Web ↔ Lambda parity
- Mirror the validator/migration as a pure module in `infra/lambda/curate/structure.ts`; add a shared fixture test proving web and Lambda validate identical inputs identically.

## Files touched

**Web (`web/`):**
- `lib/vault-structure/schema.ts` (new) — `validateStructure`, `migrateStructure`, extended `SpaceEntry`.
- `lib/vault-structure.ts` (or `lib/vault-structure/index.ts`) — resilient `getStructure`, `getStructureHealth`, concurrency-safe `putStructure`, `registerSpace`/`updateSpace`/`setSpaceLock`; remove `ensureSpaceInStructure` (or keep as a thin `registerSpace(..., {by:'ai'})` shim and update callers).
- `lib/ingest/run.ts` — call `registerSpace(..., { by: 'ai' })` instead of `ensureSpaceInStructure`.
- `lib/ingest-policy.ts` — `getGeneratedSpaces`, drop single-space `findIngestSpace`.
- `app/api/raw/route.ts`, `app/api/synthesize/route.ts` — honor all generated spaces.
- `structure.schema.json` (new, repo root or `web/`).
- `docs/structure-schema.md` (new).

**Ingest CLI (`ingest/`):**
- `src/commands/structure.ts` (new) + wire into `src/cli.ts` — `validate|init|add-space`.

**Lambda (`infra/lambda/curate/`):**
- `structure.ts` — pure validator/migration mirror; shared fixture test.

**No changes to:** `raw/` semantics, `processed.json` / source-card schemas, the deterministic `placementFromRawKey` design, `authored/` content handling.

## Tasks

- [ ] **Task 1 — Schema + validator + migration (pure module).** `validateStructure`, `migrateStructure`, extended `SpaceEntry` (provenance/lock). Tests: current fixture passes; v1 migrates; malformed cases (missing `spaces`, wrong types, duplicate names, unknown future `version`) produce precise errors. Demo: validator over the real `structure.json` (OK) and a broken fixture (clear error list).
- [ ] **Task 2 — Resilient `getStructure()` + health + last-known-good.** Fetch-with-ETag → validate → cache; not-found writes default; malformed logs loudly, keeps last-known-good, flags `degraded`, never silent-empty; add `getStructureHealth()`. Tests: not-found, malformed-keeps-last-good-and-degraded, valid-caches. Demo: corrupt local `structure.json` → health/log shows `degraded`, tree serves last-known-good instead of empty.
- [ ] **Task 3 — Concurrency-safe write + constrained AI mutation API.** ETag read-modify-write with retry; `registerSpace(name, opts, {by})` additive/idempotent/provenance/lock-respecting; `updateSpace`/`setSpaceLock`; `log.md` audit. Tests: simulated ETag conflict → retry → both spaces present; idempotent re-register no-op; AI cannot alter locked/existing; provenance stamped. Demo: two near-simultaneous `registerSpace` both land; AI re-run doesn't clobber a human label.
- [ ] **Task 4 — True multi-space runtime.** `getGeneratedSpaces` in `ingest-policy`; `/api/raw` + `/api/synthesize` accept any declared generated space (clear 4xx for undeclared). Tests: two generated spaces each return their own pending; undeclared rejected clearly. Demo: declare `wiki` + `canopy` generated, upload raw to each, process → both populate and show in the sidebar.
- [ ] **Task 5 — Versioning write-back, JSON Schema + docs, CLI, Lambda parity, dead-field trim.** Wire migration into `getStructure` with concurrency-safe write-back; reject unknown future versions as `degraded`; emit `structure.schema.json` + `docs/structure-schema.md`; add `ingest structure validate|init|add-space`; mirror validator in Lambda with a shared fixture test; remove dead `folders`/single-space assumptions. Tests: v1 migrates + persists; CLI exit codes; web and Lambda validate identical fixtures identically. Demo: v1 `structure.json` auto-migrates and persists; `pnpm ingest structure validate` green; AI-created space appears in `log.md`.

## Verification gate

`pnpm --filter @canopy/web typecheck` + web build; curate Lambda `tsc` + `npm test`; new unit tests for schema/validator/migration and the multi-space routes. Clean up any temp files. No commits/pushes unless the user asks.

## Out of scope (deferred)

- **Spec 2 — HTML documents & themed reports.** First-class `.html` vault docs (sanitized-inline, portal-themed) and themed HTML reports stored in the vault (export of existing content first; AI-synthesis report variant later). Spec 2 will add `structure.json` fields (an `.html`-allowed flag, a `reports` block: output prefix, templates, default theme) on top of this validated schema.
- Full structure-editing UI (a read-only health view is enough here).
- Synthesis pipeline implementation (curation-pipeline tasks 4/5) — tracked separately in `specs/synthesis-pipeline.md`.
