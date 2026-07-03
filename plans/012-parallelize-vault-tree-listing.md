# Plan 012: Parallelize the sidebar tree's S3 listings

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- web/lib/vault-tree.ts`
> On drift, compare "Current state" excerpts against live code; on mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/003 (e2e in CI — the tree is asserted by several specs)
- **Category**: perf
- **Planned at**: commit `fead8f9`, 2026-07-03

## Why this matters

`getTree()` runs on every home/doc SSR render (both pages are
`force-dynamic`), again in `GET /api/vaults/[id]/tree`, and again from the
client after every upload/folder operation. It issues **2 sequential S3 LIST
round-trips per space** (generated + authored), plus one for personal, plus
the structure read — all serialized with `await` in `for` loops. With N
spaces every navigation blocks on ~2N+2 sequential S3 calls; latency grows
linearly with space count. Parallelizing with `Promise.all` is a pure loss-free
win: results are bucketed per space and sorted deterministically afterward.

## Current state

- `web/lib/vault-tree.ts:61-124` — the whole builder. The two serial loops:

  ```ts
  // user spaces (lines 89-104)
  for (const space of userSpaces.filter((s) => s.indexed && s.name !== 'personal')) {
    const generated = (await listObjects(userScope.generatedPrefix(space.name))).filter(isDocumentKey);
    const authored = (await listObjects(userScope.authoredPrefix(space.name))).filter(isDocumentKey);
    if (!generated.length && !authored.length) continue;
    …userChildren.push({ type: 'folder', id: `folder:__user/${space.name}`, … });
  }
  // shared spaces (lines 112-124)
  for (const space of structure.spaces.filter((s) => s.indexed)) {
    const generated = (await listObjects(generatedPrefix(space.name))).filter(isDocumentKey);
    const authored = (await listObjects(authoredPrefix(space.name))).filter(isDocumentKey);
    …tree.push({ type: 'folder', id: `folder:${space.name}`, … });
  }
  ```

  Plus `personalKeys` (line 72) and `getStructure()` (line 62) ahead of them.
- Ordering semantics to PRESERVE exactly: `__user` folder first (personal
  child first, then user spaces in declaration order), then shared spaces in
  declaration order. `insert`/`addKeys` push in key-iteration order —
  `listObjects` returns S3 lexicographic order; keep per-space child order
  identical by keeping the per-space `addKeys` calls in the same sequence
  (generated then authored).
- `TreeNode` shape (lines 12-14) is consumed by the sidebar and by
  `web/app/api/vaults/[id]/tree/route.ts` — no shape change allowed.
- The tree e2e assertions live in `tests/e2e/read-paths.spec.ts`,
  `spaces.spec.ts`, `folders.spec.ts`, `upload.spec.ts`.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm typecheck`         | exit 0              |
| E2E       | `pnpm build && pnpm test:e2e` | all pass |

## Scope

**In scope**:
- `web/lib/vault-tree.ts`

**Out of scope**:
- Any caching layer (that's a design decision — see Maintenance notes).
- `web/lib/folders.ts::listFolderTree` — different structure (it already does
  two whole-root `listAllKeys` calls, not per-space); leave it.
- `web/app/page.tsx` / `[...id]/page.tsx` `force-dynamic` settings.
- The `TreeNode` shape or folder id scheme.

## Git workflow

- Branch: `advisor/012-parallel-tree-listing`
- Commit style: imperative, under 72 chars.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Gather all listings concurrently

Restructure `getTree()`:

1. `getStructure()` first (everything depends on it).
2. Build the full list of `(bucketLabel, prefix)` listing tasks: personal,
   each user space × {generated, authored}, each shared space × {generated,
   authored}.
3. Fire ALL of them with one `Promise.all(tasks.map(t => listObjects(t.prefix)))`,
   `.filter(isDocumentKey)` per result.
4. Assemble the tree from the settled results in the exact original order
   (personal → user spaces in declaration order → shared spaces in
   declaration order; generated before authored within each space). The
   assembly is synchronous — same `addKeys`/`insert` calls, same skip rules
   (`if (!generated.length && !authored.length) continue;` for user spaces —
   note shared spaces do NOT skip when empty; preserve that asymmetry).

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Regression sweep

**Verify**: `pnpm build && pnpm test:e2e` → all pass (tree ordering is
asserted indirectly by sidebar-dependent specs). Additionally diff a live
tree: run `pnpm dev` with `MOCK_S3=1`, seed via
`POST /api/test-seed` (see `tests/e2e` for its payload shape), and `curl
localhost:3000/api/vaults/default/tree` before/after the change (checkout main
vs branch) — byte-identical JSON expected.

## Test plan

- No new tests: behavior-preserving refactor; e2e sweep + the byte-diff in
  Step 2 are the gates. If plan 004's runner exists, an OPTIONAL unit test
  seeding the mock store and asserting the exact tree JSON is welcome
  (`web/lib/__tests__/vault-tree.test.ts`) — it also protects plan 013/014.

## Done criteria

- [ ] `pnpm typecheck` exits 0; e2e passes
- [ ] `web/lib/vault-tree.ts` has no `await listObjects` inside a `for` loop (`grep -n "await listObjects" web/lib/vault-tree.ts` hits only the Promise.all task construction or nothing)
- [ ] Tree JSON byte-identical for the seeded fixture (Step 2)
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The live-diff in Step 2 shows ANY ordering difference — do not "fix" by
  sorting; find the sequencing bug or stop.
- Mock S3 key-iteration order differs from real S3 lexicographic order in a
  way that the diff can't distinguish (report if suspected).

## Maintenance notes

- Deliberately deferred: a short-TTL in-process cache shared by the SSR pass
  and the client refetch, and/or replacing per-space LISTs with one
  prefix-wide `listObjects()` bucketed in memory (the approach
  `folders.ts:132-144` already uses). Both interact with plan 014
  (incremental indexing) — decide there, not here.
- Reviewer: watch for unhandled-rejection semantics — `Promise.all` rejects
  fast; the old serial code surfaced the FIRST failing prefix. Same observable
  contract (throw) either way, fine.
