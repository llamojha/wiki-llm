# Plan 015: One movePrefix/purgePrefix implementation, resumable, for all folder/space operations

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- web/lib/folders.ts web/lib/spaces.ts web/lib/vault-ops.ts tests/e2e/folders.spec.ts tests/e2e/spaces.spec.ts`
> On drift, compare "Current state" excerpts against live code; on mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (destructive S3 operations; characterization coverage first)
- **Depends on**: plans/003 (e2e in CI), plans/004 (unit runner)
- **Category**: tech-debt (fixes a correctness hazard: non-atomic moves)
- **Planned at**: commit `fead8f9`, 2026-07-03

## Why this matters

The "move every object from prefix A to prefix B" loop is hand-written in
four places and the "delete everything under a prefix" loop in three, with
semantics that have already drifted (the nested-rename path preflights target
collisions; the top-level path doesn't; `renameSpace` uses the `.md`-only
listing and needs a `.keep`-sweep workaround bolted on in `folders.ts`).
Worse, every copy is get→put→delete per key, sequentially: a failure midway
(S3 error, timeout on a big folder) leaves content split across the old and
new prefixes with no recovery path. One shared implementation with two-phase
semantics (copy everything, then delete sources) makes partial failure
recoverable by simple retry and gives future fixes a single home.

## Current state

All in `web/lib/`; each loop is `list → for each key: getObject → putObject(new) → deleteObject(old)`:

1. `folders.ts:226-235` — top-level rename leftover sweep (uses `listAllKeys`),
   run AFTER `renameSpace` already moved `.md` docs:

   ```ts
   for (const prefixFor of [sp.authoredPrefix, sp.generatedPrefix]) {
     const fromPrefix = prefixFor(fromSegs[0]);
     const toPrefix = prefixFor(toLeaf);
     for (const key of await listAllKeys(fromPrefix)) {
       const rel = key.slice(fromPrefix.length);
       const content = await getObject(key);
       await putObject(`${toPrefix}${rel}`, content);
       await deleteObject(key);
     }
   }
   ```

2. `folders.ts:260-272` — nested rename (same shape, `listAllKeys`, tracks `moved`).
3. `spaces.ts:156-166` — `renameSpace` (same shape but `listObjects` = `.md`-only
   — WHY the sweep in (1) exists).
4. Deletes: `folders.ts:303-307` (post-`deleteSpace` marker purge),
   `folders.ts:316-322` (nested delete, counts `removed`), `spaces.ts:213-216`
   (`.md`-only delete loop).
- Preflight that must be UNIFIED, not lost: nested rename checks target
  emptiness across both roots before moving (`folders.ts:254-258`); top-level
  rename has no equivalent (only the structure-declaration name check in
  `spaces.ts:151-153`).
- `web/lib/s3.ts` primitives available: `listAllKeys`, `getObject`,
  `putObject`, `deleteObject`. There is NO server-side S3 CopyObject wrapper —
  adding one to `s3.ts` + `s3-mock.ts` is in scope (CopyObjectCommand avoids
  round-tripping bodies through the app).
- E2E coverage exists: `tests/e2e/folders.spec.ts`, `spaces.spec.ts` (rename,
  delete, `.keep` persistence). These are the characterization safety net.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm typecheck`         | exit 0              |
| Unit      | `pnpm --filter @canopy/web test` | all pass |
| E2E       | `pnpm build && pnpm test:e2e -- --grep "folders|spaces|upload"` | all pass |

## Scope

**In scope**:
- `web/lib/vault-ops.ts` (create — `movePrefix`, `purgePrefix`)
- `web/lib/s3.ts` + `web/lib/s3-mock.ts` (add `copyObject(fromRel, toRel)`)
- `web/lib/folders.ts`, `web/lib/spaces.ts` (replace the 7 loops)
- `web/lib/__tests__/vault-ops.test.ts` (create)

**Out of scope**:
- `structure.json` handling (plans/007 owns it; call order around the moves
  stays exactly as it is).
- Index regeneration and `invalidateSearchIndex` calls — same call sites,
  same order.
- Any route handler.
- True atomicity (impossible on S3) — the goal is idempotent resumability,
  document it as such.

## Git workflow

- Branch: `advisor/015-vault-ops`
- Commit style: imperative, under 72 chars; s3 primitive, vault-ops, then the
  two consumers as separate commits.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `copyObject` primitive

`web/lib/s3.ts`: `copyObject(fromRel, toRel)` via `CopyObjectCommand`
(`CopySource: `${bucket}/${fullKey(fromRel)}`` — URL-encode the CopySource per
SDK requirements). Mirror in `s3-mock.ts` (read from store, write new key).
Add the `trace('COPY', …)` call matching the module's tracing style.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: `vault-ops.ts`

```ts
/**
 * Move every object under fromPrefix to toPrefix — two-phase and idempotent:
 * copy ALL objects first, then delete ALL sources. A crash between phases
 * leaves duplicates (safe), never a split move; re-running completes it
 * (already-copied keys are recopied harmlessly).
 * Returns the number of objects moved.
 */
export async function movePrefix(fromPrefix: string, toPrefix: string): Promise<number>

/** Delete every object under prefix. Returns count. Idempotent. */
export async function purgePrefix(prefix: string): Promise<number>

/** True when any object exists under prefix (collision preflight). */
export async function prefixHasObjects(prefix: string): Promise<boolean>
```

`movePrefix`: `listAllKeys(fromPrefix)` → phase 1 copy (batched
`Promise.all` of 10) → phase 2 delete sources (batched 10). Always
`listAllKeys` — the `.md`-only variant is the root cause of the `.keep`
workarounds. No index/log/search side effects in this module (callers own
those).

**Verify**: `pnpm typecheck`; unit tests (Step 4 cases for vault-ops) pass.

### Step 3: Replace the seven loops

- `spaces.ts::renameSpace`: the two-root loop (156-166) →
  `for (const prefixFor of […]) await movePrefix(prefixFor(from), prefixFor(to));`
  Because `movePrefix` uses `listAllKeys`, the leftover-sweep in
  `folders.ts:224-235` becomes dead — DELETE that sweep and its comment; the
  top-level `renameFolder` branch reduces to `renameSpace` + return.
  ALSO add the missing preflight: before moving, `prefixHasObjects` on both
  target roots → throw `SpaceError(409, 'Space "<to>" already has content')`
  (this closes the drift where top-level renames could merge into a
  non-empty target — a deliberate behavior change; note it in the commit).
- `folders.ts::renameFolder` nested branch: preflight loop (254-258) →
  `prefixHasObjects`; move loop (260-272) → `movePrefix` per root, summing the
  return for the `!moved` 404 check.
- `folders.ts::deleteFolder` nested (316-322) + top-level purge (303-307) and
  `spaces.ts::deleteSpace` loop (213-216) → `purgePrefix` (spaces.ts's
  `.md`-only delete also left `.keep` markers — same root cause; the
  folders.ts purge-after wrapper then becomes dead, delete it and let
  `deleteFolder`'s top-level branch call `deleteSpace` alone; VERIFY
  deleteSpace now purges everything by running the folders e2e spec).

**Verify**: `pnpm typecheck`; `pnpm build && pnpm test:e2e -- --grep "folders|spaces|upload"`
→ all pass.

### Step 4: Tests

`vault-ops.test.ts` (mock S3): move with nested keys + `.keep` markers (all
arrive, sources gone, count right); move onto existing target keys overwrites
(documented semantics); purge removes non-`.md` too; **resumability**: spy
`deleteObject` to throw after the copy phase → rerun `movePrefix` → final
state correct, no key lost (the split-move regression); `prefixHasObjects`
true/false.

**Verify**: `pnpm --filter @canopy/web test` → all pass.

## Test plan

As Step 4 + the folders/spaces e2e specs as characterization. Add one e2e
case: rename a space onto a name whose prefixes contain objects → 409 (the
new preflight).

## Done criteria

- [ ] `grep -n "await putObject(\`\${toPrefix}" web/lib/folders.ts web/lib/spaces.ts` → no inline move loops remain
- [ ] `movePrefix` two-phase resumability test passes
- [ ] folders/spaces/upload e2e green; full suite green
- [ ] `pnpm typecheck` exits 0
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- An e2e spec depends on the OLD merge-into-non-empty-target rename behavior
  (the new 409 preflight breaks it) — report; the behavior change needs a
  human decision.
- `CopyObjectCommand` semantics (metadata/content-type propagation) differ
  from get+put in a way a test catches — report before switching strategies.
- The `deleteSpace`-covers-markers assumption in Step 3 fails the e2e spec.

## Maintenance notes

- Plan 016's Folders tab and any future bulk ops should call vault-ops, never
  hand-roll loops — mention in review.
- A future completion-marker (`_system/moves/<id>.json`) would make moves
  observable/resumable across process crashes; deferred until an operation is
  big enough to need it.
- Reviewer focus: the two deliberate behavior changes (top-level rename
  preflight 409; deletes now purge non-`.md` keys everywhere).
