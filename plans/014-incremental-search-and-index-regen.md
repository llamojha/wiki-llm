# Plan 014: Incremental search-index and space-index updates (stop O(vault) work per write)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- web/lib/search.ts web/lib/index-gen.ts`
> On drift, compare "Current state" excerpts against live code; on mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: MED (correctness of invalidation; two derived stores)
- **Depends on**: plans/004 (unit runner), plans/012 and plans/013 (land first — they reshape the same modules)
- **Category**: perf
- **Planned at**: commit `fead8f9`, 2026-07-03

## Why this matters

Every single-document mutation triggers O(vault) work twice over:

1. `invalidateSearchIndex()` throws away the whole Fuse index; the next search
   (or, after plan 013, the next home view) re-`getObject`s every document.
2. `regenerateIndexesForKey(key)` re-lists and re-reads every doc in the
   affected space AND every doc in every space for the master index
   (`regenerateMasterIndex`), on each save.

On serverless (the deploy targets include Vercel/Fargate) the module cache
rarely survives between requests anyway, making cold rebuilds the norm. This
plan makes both derived stores incremental for the single-key write path,
keeping full rebuild as the reindex-route fallback.

**This is the largest and least-urgent plan — do not start it before 012/013
have landed and the unit baseline exists.**

## Current state

- `web/lib/search.ts` — module cache `_promise` (after plan 013: `{ fuse,
  entries }` + `getAllEntries`). `invalidateSearchIndex()` nulls it. Callers of
  invalidate: spaces.ts (3×), folders.ts (3×), upload route, docs routes,
  reindex route, star route (verify — plan 013 step 3).
- `web/lib/index-gen.ts`:
  - `regenerateSpaceIndex(space, scope)` — lists both provenance prefixes for
    the space, `buildLine` (a `getObject` per doc) → writes
    `_system/indexes/<space>.md`.
  - `regenerateMasterIndex(scope)` — same crawl over EVERY declared space →
    writes `_system/index.md`.
  - `regenerateIndexesForKey(key)` — infers scope+space, calls both.
- Index file format (must stay byte-compatible — the agent's catalog loader
  and plan-001's regression test parse it):
  `- <key> — <title> — <80-char summary>` lines under `## <Label>` sections
  (master) / flat list with a frontmatter header (space index). Note both
  files carry `updated: <now ISO>` in frontmatter — timestamps WILL differ per
  write; "byte-compatible" means modulo that line.
- Fuse.js supports incremental ops: `fuse.add(doc)`, `fuse.remove(predicate)`
  / `fuse.removeAt(idx)` — verify against the installed `fuse.js@^7.4.2` API
  (`node -e "const F=require('fuse.js'); console.log(typeof F.prototype.add, typeof F.prototype.remove)"`
  from `web/`).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm typecheck`         | exit 0              |
| Unit      | `pnpm --filter @vaultmark/web test` | all pass |
| E2E       | `pnpm build && pnpm test:e2e` | all pass |

## Scope

**In scope**:
- `web/lib/search.ts` — add `upsertSearchEntry(key)` / `removeSearchEntry(key)`
- `web/lib/index-gen.ts` — add `patchSpaceIndexForKey(key)` incremental path
- Call sites that currently pair a single-key write with full invalidation:
  `web/app/api/docs/route.ts` (POST), `web/app/api/docs/[...id]/route.ts`
  (PUT/DELETE), `web/app/api/star/[...id]/route.ts`, `web/app/api/upload/route.ts`
- `web/lib/__tests__/search-incremental.test.ts`, extend index-gen tests

**Out of scope**:
- Bulk operations keep FULL invalidation/rebuild: `web/lib/folders.ts`,
  `web/lib/spaces.ts` (rename/delete touch many keys — full rebuild is
  correct and simpler), and the reindex route (its purpose IS full rebuild).
  Do not touch these files.
- Persisting the Fuse index to S3 (rejected for now: serialization/version
  coupling; revisit if serverless cold starts dominate after this lands).
- The master index's per-write regeneration policy — see Step 3 decision.

## Git workflow

- Branch: `advisor/014-incremental-indexing`
- Commit style: imperative, under 72 chars; one commit per step.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Incremental search-entry ops

In `search.ts`:

```ts
/** Upsert one document into the cached index (no-op when cache is cold). */
export async function upsertSearchEntry(key: string): Promise<void>
/** Remove one document from the cached index (no-op when cache is cold). */
export function removeSearchEntry(key: string): void
```

Semantics: if `_promise` is null (cold), do nothing — the next full build
picks the change up; that's what makes this safe on serverless. If warm:
read the one object, rebuild ITS entry (same code path as `buildIndex`'s
per-doc block — extract a shared `entryForKey(key, raw)` helper), `fuse.remove`
any entry with that id, `fuse.add` the new one, and patch the `entries` array
(plan 013's home view reads it). All under the resolved cached object —
concurrent searches during the patch see either old or new entry, never a
broken index (single-threaded event loop; no awaits between remove/add/array
patch — do the S3 read BEFORE mutating).

Switch call sites: docs POST/PUT → `await upsertSearchEntry(key)`;
docs DELETE → `removeSearchEntry(key)`; star PATCH → `upsertSearchEntry`;
upload route (authored destination only — raw uploads aren't documents) →
`upsertSearchEntry`. Remove the paired `invalidateSearchIndex()` calls at
those sites ONLY.

**Verify**: `pnpm typecheck`; unit tests (Step 4) pass; e2e search/editor/
star/upload specs pass.

### Step 2: Incremental space-index patching

In `index-gen.ts`, add `patchSpaceIndexForKey(key)`: read the existing
`_system/indexes/<space>.md`; find the line starting `- ${key} — `; build the
new line with the existing `buildLine(key)` (one `getObject`); replace/append/
remove (deletion variant takes a flag or a separate function —
`removeKeyFromSpaceIndex(key)`); bump the frontmatter `updated`; write back.
If the index file does not exist or the key's space can't be inferred, fall
back to the current full `regenerateSpaceIndex`.

Rewire `regenerateIndexesForKey` (the single-key entry point used by docs
routes) to use the patch path for the space index. Keep exported full-rebuild
functions unchanged for the bulk callers.

**Verify**: `pnpm typecheck`; index-gen unit tests pass.

### Step 3: Master-index policy

Patching the master index per write has the same line-replace shape — but its
sections span all spaces. Implement `patchMasterIndexForKey(key)` with the
same line-level replace within the key's `## <Label>` section, falling back to
`regenerateMasterIndex` when the section is missing (new space's first doc).
Concurrency caveat: line-patching a shared file is read-modify-write — the
same hazard class as plans/007/011. Acceptable here because (a) the file is
derived (self-healing on next full reindex) and (b) single-user MVP; put that
rationale in a code comment. If plans/007's `ConcurrencyError` machinery is
available, use ETag ifMatch + one retry, falling back to full regenerate.

**Verify**: `pnpm typecheck`; unit tests pass.

### Step 4: Tests

- `search-incremental.test.ts` (mock S3): warm index → edit doc → search finds
  new content without a full rebuild (assert `getObject` call count via a spy:
  exactly 1 read for the upsert); delete → entry gone; cold cache → upsert
  no-ops and next `search()` builds fresh; entries array (home view) reflects
  the patch.
- index-gen tests: patch replaces exactly one line; delete removes it; new-key
  append; missing-index fallback to full rebuild; master patch section edit.
- Byte-format check: full rebuild vs patched file identical modulo the
  `updated:` timestamp line for a seeded fixture.

**Verify**: `pnpm --filter @vaultmark/web test` → all pass;
`pnpm build && pnpm test:e2e` → all pass.

## Test plan

As Step 4. E2E suite is the integration gate (editor/star/upload/search/
reindex specs all touch these paths).

## Done criteria

- [ ] Single-doc create/edit/delete/star performs exactly ONE document read for index maintenance (asserted by the spy test)
- [ ] `grep -n "invalidateSearchIndex" web/app/api/docs web/app/api/star web/app/api/upload` → no hits (moved to incremental), while folders.ts/spaces.ts/reindex still call it
- [ ] Patched index files byte-match full rebuilds modulo timestamp
- [ ] `pnpm typecheck`, unit, e2e all green
- [ ] `plans/README.md` status row updated

## STOP conditions

- Installed Fuse 7.x lacks `add`/`remove` (API check in Current state fails).
- Plans/012 or /013 have not landed (their reshapes conflict — coordinate).
- The byte-format check cannot be satisfied because `buildLine` output depends
  on read order — report the specific divergence.
- You find the master-index patch causing e2e flakiness twice — fall back to
  `regenerateMasterIndex` for the master (keep space-index patching) and note
  the partial delivery in the index.

## Maintenance notes

- This cements an invariant: EVERY single-key write path must call
  upsert/remove; a new route that writes docs and forgets will have stale
  search until the next full build (self-healing, but note it in review
  checklists).
- Follow-up candidates deliberately deferred: persist the entries array to
  `_system/search-cache.json` for serverless cold starts; move tree building
  (plan 012) onto the same entries store.
