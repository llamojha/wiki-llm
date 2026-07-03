# Plan 001: Make single-space re-index stop overwriting the master index

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- web/app/api/reindex/route.ts web/lib/index-gen.ts tests/e2e/reindex.spec.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `fead8f9`, 2026-07-03

## Why this matters

The Library modal's "Re-index this folder" action posts `{ space }` to
`POST /api/reindex`. When a single space is supplied, the route rebuilds the
master `_system/index.md` **from only that one space**, silently dropping every
other space from the catalog. The master index is what the ask-wiki agent uses
as its catalog and what the homepage nav renders — after one folder re-index,
the agent and homepage only "see" that folder until a full re-index runs. If
the re-indexed space happens to be empty, the master index is emptied entirely.

## Current state

- `web/app/api/reindex/route.ts` — the streaming re-index route. The bug:
  - Line 61-62: when `space` is supplied, `targetSpaces = [space]`.
  - Lines 104-115: the master index is derived solely from `spaceKeys` (which
    contains only `targetSpaces`) and written unconditionally:

  ```ts
  // web/app/api/reindex/route.ts:103-115
  // Master index — shared excludes personal, user scope includes everything.
  const masterSpaces = scope.scope === 'shared'
    ? spaceKeys.filter((sk) => sk.space !== 'personal')
    : spaceKeys;
  const sections: string[] = [];
  for (const sk of masterSpaces.sort((a, b) => a.space.localeCompare(b.space))) {
    const lines = spaceLines.get(sk.space);
    if (!lines?.length) continue;
    const label = declaredSpaces.find((s) => s.name === sk.space)?.label ?? toTitleCase(sk.space);
    sections.push(`## ${label}\n${lines.join('\n')}`);
  }
  const masterBody = `---\ntitle: Index\ntype: nav\nupdated: ${new Date().toISOString()}\n---\n\n${sections.join('\n\n')}\n`;
  await putObject(scope.systemKey('index.md'), masterBody);
  ```

- `web/lib/index-gen.ts` — already contains the correct aggregation:
  `regenerateMasterIndex(scope)` (lines 84-111) reads the structure manifest,
  iterates **all** declared `indexed` spaces for the scope, lists both
  provenance prefixes per space, and writes the full master index. It is the
  function used by every other write path (`web/lib/folders.ts:278`,
  `web/lib/spaces.ts:182`).
- The full-reindex path (no `space` in the body) is NOT buggy: there
  `targetSpaces` covers all declared spaces, so the hand-rolled master build
  happens to produce the right content. Only the single-space branch corrupts.
- Convention: route handlers return `{ detail: string }` error bodies; this
  route streams NDJSON progress lines (`send({type: 'progress' ...})`).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `pnpm install`           | exit 0              |
| Typecheck | `pnpm typecheck`         | exit 0, no errors   |
| Build     | `VAULT_BUCKET=build-placeholder pnpm build` | exit 0 |
| E2E       | `pnpm build && pnpm test:e2e` (from repo root; needs the build) | all pass |

## Scope

**In scope** (the only files you should modify):
- `web/app/api/reindex/route.ts`
- `tests/e2e/reindex.spec.ts` (extend)

**Out of scope** (do NOT touch, even though they look related):
- `web/lib/index-gen.ts` — the correct implementation you will call; no change needed.
- `web/components/upload-modal.tsx` — the client that posts `{ space }`; its behavior is correct.
- The full-reindex (no-`space`) master-build path's output format — the master
  index format (`## <Label>` sections of `- key — title — summary` lines) must
  not change; the agent's catalog loader parses it.

## Git workflow

- Branch: `advisor/001-fix-single-space-reindex`
- Commit style: imperative mood, under 72 chars (repo convention, e.g.
  "Fix uploaded docs missing from sidebar tree"). One logical change.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Rebuild the master index via `regenerateMasterIndex` in the single-space branch

In `web/app/api/reindex/route.ts`:

1. Import `regenerateMasterIndex` from `@/lib/index-gen`.
2. Keep the per-space index writes (lines 90-101) exactly as they are — the
   per-space `indexes/<space>.md` regeneration is correct for both branches.
3. Replace the master-index block (lines 103-115) with:
   - If `space` was supplied (single-space mode): `await regenerateMasterIndex(scope);`
   - Else (full mode): keep the existing inline master build unchanged. (It
     avoids re-reading every doc a second time, which `regenerateMasterIndex`
     would do; the inline build is correct in this branch because `spaceKeys`
     covers all declared spaces.)

The resulting shape:

```ts
if (space) {
  // Single-space mode: per-space index above is enough; rebuild the master
  // from ALL declared spaces so the other sections are not dropped.
  await regenerateMasterIndex(scope);
} else {
  // Full mode: spaceKeys covers every declared space; build inline to avoid
  // re-reading each document a second time.
  /* existing lines 103-115 unchanged */
}
```

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Add an e2e regression test

In `tests/e2e/reindex.spec.ts`, add a test following the existing specs'
structure (they seed via the `test-seed` route — read the top of the file and
`tests/e2e/helpers.ts` for the seeding/fixture pattern before writing):

1. Seed documents in two different shared spaces (e.g. `wiki` and `articles`).
2. Run a full re-index (POST `/api/reindex` with `{}`), confirming the master
   index contains both space sections.
3. Re-index only one space (POST `/api/reindex` with `{ space: 'wiki' }`).
4. Fetch the master index content (via `GET /api/raw?key=_system/index.md` if
   that route exists — check `web/app/api/raw/route.ts` for its query shape —
   or via the test-seed/dump helper used by other specs) and assert it still
   contains BOTH `## Wiki` and `## Articles` sections.

**Verify**: `pnpm build && pnpm test:e2e -- --grep reindex` → all pass,
including the new test. (Run the two flags-off/on servers as configured; the
suite is mock-backed and needs no AWS.)

## Test plan

- New e2e case in `tests/e2e/reindex.spec.ts`: "single-space reindex preserves
  other spaces in the master index" (the regression this plan fixes), as
  described in Step 2. Model after the existing tests in the same file.
- Existing reindex specs must keep passing (full-reindex behavior unchanged).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm build && pnpm test:e2e` exits 0; the new regression test exists and passes
- [ ] In `web/app/api/reindex/route.ts`, the single-space branch calls `regenerateMasterIndex` and no longer writes `scope.systemKey('index.md')` from `targetSpaces`-derived sections
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at lines 60-115 of `web/app/api/reindex/route.ts` doesn't match the
  excerpt above (drift).
- `regenerateMasterIndex`'s signature is not `(scope?: ScopePaths) => Promise<void>`.
- The e2e suite has no existing mechanism to read back `_system/index.md`
  content — report what you found instead of inventing a new test-only route.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- If Plan 014 (incremental index regeneration) lands later, it will replace
  both branches here; this fix is still worth landing first because it is tiny
  and the corruption is user-reachable today.
- Reviewer should scrutinize: the streamed NDJSON progress events must be
  unchanged (the modal parses them); only the master-index write changes.
