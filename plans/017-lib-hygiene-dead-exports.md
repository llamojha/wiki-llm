# Plan 017: Remove dead vault-path exports and the listSpaces name collision

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- web/lib/vault-paths.ts web/lib/s3.ts web/lib/s3-mock.ts`
> On drift, compare "Current state" excerpts against live code; on mismatch, STOP.

## Status

- **Priority**: P2 (cheap; do before the repo goes public)
- **Effort**: S
- **Risk**: LOW (deletions only, verified by grep + typecheck)
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `fead8f9`, 2026-07-03

## Why this matters

`web/lib/vault-paths.ts` exports seven path helpers with zero callers —
scope-based prefixes from `web/lib/scope.ts::resolveScope` replaced them —
and `web/lib/s3.ts` exports a `listSpaces()` (S3 CommonPrefixes-based) that
nothing calls, while the `listSpaces()` every route actually uses lives in
`web/lib/spaces.ts` (structure-manifest-based). Two same-named exports with
different semantics in adjacent modules is a live wrong-import foot-gun, and
the dead helpers enlarge the "path authority" surface a reader must reason
about. Pure deletion, verified mechanically.

## Current state

- Dead in `web/lib/vault-paths.ts` (verified zero callers at `fead8f9` via
  `grep -rn <name> web/app web/components web/lib --include='*.ts*'` excluding
  the definition file): `userPrefix` (51), `userRawPrefix` (55),
  `userGeneratedPrefix` (59), `userAuthoredPrefix` (63), `userSystemKey` (71),
  `generatedSpaceFromKey` (101), `authoredSpaceFromKey` (108).
  **CAUTION — NOT dead**: `personalPrefix` (67) calls `userAuthoredPrefix`
  internally AND has external callers (`docs/route.ts:121`, `vault-tree.ts`).
  When deleting `userAuthoredPrefix`, inline its one-liner into
  `personalPrefix`:

  ```ts
  export function personalPrefix(userId = DEFAULT_USER_ID): string {
    return `${USERS_ROOT}/${userId}/authored/${PERSONAL_SPACE}/`;
  }
  ```

- Dead in `web/lib/s3.ts:66-84`: `export async function listSpaces()` — S3
  Delimiter listing; callers of the NAME all import from `@/lib/spaces`
  (verified: `web/app/api/spaces/route.ts` and `web/lib/folders.ts` both
  import it from `'@/lib/spaces'`). The mock twin `listSpaces` in
  `web/lib/s3-mock.ts` (referenced at `s3.ts:69` `mock.listSpaces()`) dies
  with it.
- `web/lib/ingest/` also imports from vault-paths — re-run the greps INCLUDING
  `web/lib/ingest` and the `ingest/` workspace package (`grep -rn --include='*.ts' <name> ingest/src`)
  before each deletion; the audit checked `web/` only.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Callers   | `grep -rn "<name>" web ingest --include='*.ts' --include='*.tsx' \| grep -v node_modules` | only the definition |
| Typecheck | `pnpm typecheck`         | exit 0              |
| Ingest    | `pnpm --filter @canopy/ingest exec tsc --noEmit` (check ingest has a tsconfig; if it has its own typecheck script, use it) | exit 0 |
| E2E       | `pnpm build && pnpm test:e2e` | all pass |

## Scope

**In scope**:
- `web/lib/vault-paths.ts` (delete 7 exports; inline one body into `personalPrefix`)
- `web/lib/s3.ts`, `web/lib/s3-mock.ts` (delete both `listSpaces`)

**Out of scope**:
- `web/lib/spaces.ts::listSpaces` — the live one; untouched.
- Renaming anything that survives.
- `legacy/`, `portal/`, `api/` — archived; never count them as callers.
- Root-level file cleanup — plans/018.

## Git workflow

- Branch: `advisor/017-dead-exports`
- One commit: "Remove dead vault-path helpers and unused s3.listSpaces".
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Verify then delete, one symbol at a time

For each of the 8 symbols (7 vault-paths + s3 `listSpaces`): run the caller
grep (Commands table) → confirm only definitions/mock-twin hits → delete.
Handle the `personalPrefix` inline per Current state. Delete the mock's
`listSpaces` and the `mock.listSpaces()` dispatch line together with the real
one.

**Verify**: `pnpm typecheck` → exit 0 after ALL deletions (a missed caller
fails here); ingest typecheck → exit 0.

### Step 2: Regression

**Verify**: `pnpm build && pnpm test:e2e` → all pass;
`grep -rn "listSpaces" web/lib/s3.ts web/lib/s3-mock.ts` → no hits.

## Test plan

No new tests — deletion validated by typecheck + full e2e. (If plan 004's
vault-paths tests landed first, delete any tests covering removed symbols in
the same commit.)

## Done criteria

- [ ] The 7 helpers gone from `web/lib/vault-paths.ts`; `personalPrefix` self-contained
- [ ] Exactly one `listSpaces` remains in `web/lib` (in `spaces.ts`)
- [ ] `pnpm typecheck` (web + ingest) and full e2e green
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Any grep finds a caller outside definition/mock (including `ingest/` or a
  dynamic string reference) — report it; do not delete that symbol.
- Typecheck failures that aren't a straightforward missed-caller.

## Maintenance notes

- `web/lib/scope.ts` is now unambiguously the path authority for scoped
  prefixes; vault-paths keeps only constants + key classification. A one-line
  module doc comment in vault-paths.ts saying exactly that is a welcome
  addition (not required).
- Plan 019 (ESLint) can enforce no-unused-exports going forward
  (`eslint-plugin-import/no-unused-modules`) — note for its executor.
