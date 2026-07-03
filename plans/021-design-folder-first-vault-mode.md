# Plan 021: Design a folder-first vault mode (plain folders as the default, AI pipeline opt-in)

> **Executor instructions**: This is a **design/spike plan** — the deliverable
> is a written spec plus a thin proof-of-read, NOT a full implementation.
> Follow the steps, honor STOP conditions, and update `plans/README.md` when
> done.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- web/lib/vault-paths.ts web/lib/vault-tree.ts web/lib/vault-structure.ts web/lib/scope.ts prd_vaultmark_markdown_llm_wiki.md`
> On material drift in the path/tree modules, re-derive the "Current state"
> facts before writing the spec.

## Status

- **Priority**: P2
- **Effort**: M–L (design + spike; implementation is a follow-up plan)
- **Risk**: LOW (spec + read-only spike)
- **Depends on**: none (read plans/012/013/014 to avoid contradicting their direction)
- **Category**: direction / design
- **Planned at**: commit `fead8f9`, 2026-07-03
- **Scope amendment (2026-07-04)**: this spec now ALSO adjudicates
  [`specs/storage-v2-proposal.md`](../specs/storage-v2-proposal.md) — a
  Confluence-model counter-proposal (metadata-driven provenance, ID-keyed
  pages, derived views, events-as-truth). See the amended Step 2 below and
  ROADMAP.md "Track C". The deliverable is one unified storage/structure
  spec, not two competing ones.

## Why this matters

The vault layout is **provenance-first**: content must live under
`raw/` → `generated/<space>/` → `authored/<space>/` (and per-user mirrors).
That layout exists to serve the AI curation pipeline — but the feature-flag
defaults tell the real story: a default deployment ships with curate/upload/
editor OFF. A user who points Vaultmark at an existing bucket of plain
Markdown folders — the "I just have a folder tree of notes" case, which is
the most common on-ramp imaginable — sees an empty portal, because nothing
outside the provenance roots is recognized as a document (`isDocumentKey`
returns false for `notes/foo.md`). The maintainer wants folder-first to be
the **default** experience, with the ai-generated/raw pipeline as the opt-in
layer on top. This plan produces the design that makes that true without
breaking existing vaults.

## Current state (what hard-codes provenance-first)

- `web/lib/vault-paths.ts:79-93` — `isDocumentKey` only admits keys under
  `generated/`, `authored/`, `users/<id>/generated/`, `users/<id>/authored/`.
  Everything else in the bucket is invisible.
- `web/lib/vault-paths.ts:95-99` — `sourceTypeFromKey` assumes the same roots.
- `web/lib/scope.ts:61-86` — `resolveScope` produces prefix builders per
  provenance root; `inferScopeFromKey` (95-101) keys off `users/`.
- `web/lib/vault-structure.ts` — `structure.json` declares spaces per scope;
  a space is meaningful only as a segment under the provenance roots.
- `web/lib/vault-tree.ts:61-124` — the sidebar tree walks
  personal + user spaces + shared spaces, two LISTs per space.
- `web/lib/index-gen.ts` — space/master indexes list the two prefixes per space.
- `web/lib/search.ts:46-48` — index builds from `listObjects()` filtered by
  `isDocumentKey`.
- Upload/editor write paths compose keys via `scope.authoredPrefix(space)` etc.
- PRD (`prd_vaultmark_markdown_llm_wiki.md`) §data-model and
  `.kiro/steering/philosophy.md` commit to: Markdown in S3 as source of
  truth, one vault = bucket+prefix, frontmatter canonical, portability (no
  lock-in). NONE of these mandate the provenance layout — the layout is an
  implementation decision from the curate phases.
- Feature-flag reality (`web/lib/flags.ts:62-71`): default profile is
  browse + agent only — i.e. the default user never touches raw/generated
  anyway.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck (spike) | `pnpm typecheck` | exit 0 |
| E2E (unchanged)   | `pnpm build && pnpm test:e2e` | all pass (spike must not break anything) |

## Scope

**In scope**:
- `specs/folder-first-vault.md` (create — the deliverable)
- A read-only spike branch exercising the riskiest assumption (Step 3);
  spike code may touch `web/lib/*` locally but MUST NOT be part of the
  deliverable commit unless it is behind an unset-by-default env var

**Out of scope**:
- Shipping the mode — that's the follow-up implementation plan the spec ends
  with.
- Any change to existing provenance-vault behavior.
- Multi-tenant questions beyond noting interactions (Phase 6).

## Git workflow

- Branch: `advisor/021-folder-first-design`
- The deliverable commit contains `specs/folder-first-vault.md` (+ optional
  flag-guarded spike) only.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Inventory every provenance assumption

Grep-driven: `grep -rn "generated/\|authored/\|rawPrefix\|GENERATED_ROOT\|AUTHORED_ROOT" web/lib web/app --include='*.ts*' | grep -v __tests__` —
produce the spec's "touch list" table: module → assumption → what
folder-first needs from it. (The Current state list above is the starting
skeleton; verify and complete it.)

### Step 2: Write the design in `specs/folder-first-vault.md`

Required sections:

1. **Modes.** Define `vault mode: 'folders' | 'provenance'` — proposed
   resolution order: explicit `VAULT_MODE` env → sniff (`structure.json` or
   provenance roots present ⇒ provenance; else folders) → default `folders`.
   Design decision to argue: sniffing vs explicit-only (recommend explicit
   with sniffed fallback + a startup log line, matching the `[s3] runtime
   config` logging precedent in `web/lib/s3.ts:43-46`).
2. **Document recognition.** In folders mode `isDocumentKey` ≈ "any `.md`
   not under `_system/` and not a reserved filename". Spell out the reserved
   set (`_system/`, `.keep`, `index.md`?, `log.md`?) and the `source_type`
   story (everything is `authored`? introduce `source_type: 'file'`? —
   recommend: frontmatter wins, fallback `authored`).
3. **Tree & indexing.** Folder tree = the actual S3 key tree (one prefix-wide
   LIST, bucketed — note this aligns with plans/012/014's direction, cite
   them). Spaces/`structure.json`: NOT used in folders mode; the top-level
   folders ARE the spaces. Define what the master index contains and whether
   `_system/` is still written (recommend yes — agent catalog unchanged).
4. **Write paths.** Editor/upload in folders mode write to the user-chosen
   folder path directly. Folder CRUD = plans/015's `movePrefix`/`purgePrefix`
   on arbitrary prefixes. The personal space: does it exist in folders mode?
   (Recommend: no `users/` tree in folders mode single-user; document the
   consequence for the scope toggle UI.)
5. **AI pipeline opt-in.** Turning `FEATURE_CURATE`/upload-to-raw ON in a
   folders-mode vault: where do `raw/` and `generated/` go? Options: (a)
   refuse — mode switch required; (b) reserved `_vaultmark/` subtree; (c)
   provenance roots appear alongside user folders. Argue and pick (lean (b)
   or (a); (c) recreates today's confusion).
6. **Migration & coexistence.** Existing provenance vaults keep working
   untouched (mode detection); a converter is explicitly out of scope v1.
7. **Touch list** (from Step 1) with per-module effort estimates — this
   becomes the implementation plan's skeleton.
8. **Storage-v2 adjudication** (added 2026-07-04). Read
   `specs/storage-v2-proposal.md` (including its status header) and decide,
   with rationale, each of its contested points:
   - **Structure source**: folder paths (this plan's mode) vs `parent_id`
     frontmatter (the proposal). Consider the two-mode synthesis: one
     derived-view/tree layer with two structure sources — `folders` mode
     (path-derived; zero-metadata on-ramp) and `managed` mode
     (metadata-derived; what curation/import produces).
   - **File naming**: readable slug keys (portable bucket, greppable, syncs
     into Obsidian) vs ID keys (`pg_01JAAA.md`; moves never touch S3).
     Recommended middle ground to evaluate first: slug-named files with a
     stable `id` in frontmatter — tree position from metadata, so re-parenting
     is metadata-only and only slug renames move objects.
   - **Provenance**: adopt metadata-driven provenance (kill
     `generated/`/`authored/` as folders) — the audit evidence strongly
     supports this; the spec must define the `origin`/`source_kind`
     vocabulary against the existing `source_type` values.
   - **Two-layer metadata**: frontmatter (user-owned display) vs page records
     (system-owned provenance) — this amends the "frontmatter is canonical"
     convention; record it as an explicit decisions-log change if adopted.
   - **Unaddressed in the proposal, must be answered here**: user-scope /
     multi-tenant layout (`users/<id>/` placement), migration path for
     existing provenance-rooted vaults, and ETag CAS on records/views
     (plans/007/008 pattern).
   - **Explicitly out of the adopted v1** unless separately re-decided:
     Confluence import, review-queue UX, PDF sources (ROADMAP out-of-scope
     list).
9. **Open questions for the maintainer** — anything above where the PRD is
   silent and the recommendation is genuinely contestable (target ≤5, each
   with your recommendation and why).

### Step 3: Spike the riskiest assumption (read-only)

The design stands on "one prefix-wide list can serve tree+index+search for a
plain vault". Spike it: behind `VAULT_MODE=folders` (env, default unset), make
`getTree()` return the raw folder tree of ALL `.md` keys (ignore provenance
filtering) and confirm the portal renders and reads docs from a seeded mock
store with keys like `notes/2026/todo.md`. Throwaway quality; its purpose is
to catch a hidden coupling (e.g. doc-reader route assuming `source_type`
derivable from the key, breadcrumb/display-path assumptions in
`displayPathForKey`) — record every coupling found in the spec's touch list.

**Verify**: with the env var unset, `pnpm build && pnpm test:e2e` → all pass
(zero default-behavior change); with it set + seeded mock, a manual curl of
`/api/vaults/default/tree` shows the plain folders.

### Step 4: Reconcile with the PRD

Read PRD §12 (vault files) and §16 (open questions). If folder-first
contradicts a PRD commitment, the spec must name it in a "PRD deltas"
section (per repo rules, PRD conflicts get surfaced, not silently decided).

## Test plan

Spike-only; the spec itself lists the test matrix the implementation plan
must include (mode detection, mixed trees, reserved names, deep nesting,
non-ASCII folder names).

## Done criteria

- [ ] `specs/folder-first-vault.md` exists with all 9 sections (incl. the storage-v2 adjudication) and ≤5 open questions
- [ ] Touch-list table covers every module the Step 1 grep surfaced
- [ ] Spike findings (hidden couplings) recorded in the spec
- [ ] Default behavior unchanged: full e2e green with `VAULT_MODE` unset
- [ ] `plans/README.md` status row updated

## STOP conditions

- The PRD explicitly mandates the provenance layout somewhere the recon
  missed — surface the section and stop (that's a product decision).
- The spike reveals the read path CANNOT work without `structure.json`
  (deep coupling) — write up the coupling instead of forcing the design.

## Maintenance notes

- This spec gates the follow-up implementation plan; plans/012/014/015 land
  infrastructure it reuses — sequence implementation after those.
- The maintainer's rebrand/OSS push makes folder-first the likely headline
  onboarding story ("point it at your notes folder") — the spec's README
  pitch paragraph is worth writing well.
