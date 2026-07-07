# Plan 007: ETag-guard structure.json writes (stop losing space declarations)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- web/lib/vault-structure.ts web/lib/spaces.ts web/lib/s3.ts tests/e2e/spaces.spec.ts`
> On drift, compare "Current state" excerpts against live code; on mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (touches every structure writer; needs the retry path right)
- **Depends on**: plans/004-unit-test-baseline-vitest.md (unit runner for the CAS tests)
- **Category**: bug
- **Planned at**: commit `fead8f9`, 2026-07-03

## Why this matters

`structure.json` is the authoritative manifest of declared spaces per scope.
All mutations are read-modify-write with plain `putObject`: two concurrent
operations (two uploads auto-declaring different new spaces, a create + a
rename) each read the same baseline and the last writer wins — one space
declaration silently disappears, so its content sits in S3 but never appears
in the sidebar or catalog. Documents already use ETag optimistic concurrency
(`putObject(key, body, ifMatch)` + `ConcurrencyError`); this plan brings the
manifest up to the same standard with a compare-and-swap + retry.

## Current state

- `web/lib/vault-structure.ts:106-124` — the read/write pair:

  ```ts
  export async function getStructure(): Promise<VaultStructure> {
    try {
      const raw = await getObject(STRUCTURE_KEY);
      return JSON.parse(raw) as VaultStructure;
    } catch {
      try {
        const raw = await getObject('structure.json');   // legacy fallback
        return JSON.parse(raw) as VaultStructure;
      } catch {
        return DEFAULT_STRUCTURE;
      }
    }
  }

  export async function putStructure(structure: VaultStructure): Promise<void> {
    await putObject(STRUCTURE_KEY, JSON.stringify(structure, null, 2));
  }
  ```

- Writers, all get→mutate→put with no guard:
  - `web/lib/vault-structure.ts:168-179` — `ensureSpaceInStructure` (called from
    `web/app/api/upload/route.ts` and `web/lib/folders.ts:196`)
  - `web/lib/spaces.ts:92-120` — `createSpace` (push entry)
  - `web/lib/spaces.ts:128-186` — `renameSpace` (replace entry at idx)
  - `web/lib/spaces.ts:194-229` — `deleteSpace` (splice entry)
- S3 facade already has what's needed (`web/lib/s3.ts`):
  - `getObjectWithETag(relKey)` → `{ content, etag }` (lines 234-245)
  - `putObject(relKey, body, ifMatch?)` → throws `ConcurrencyError` on
    HTTP 412 / `PreconditionFailed` (lines 248-281)
  - The mock (`web/lib/s3-mock.ts`) mirrors both, including `ConcurrencyError`.
- `mutableSpacesForScope(structure, scope, userId)` (vault-structure.ts:148-162)
  returns the mutable array inside a given structure object — the mutation API
  the writers use. Keep it; the CAS wrapper composes with it.
- Repo error convention: domain errors carry HTTP status (`SpaceError` in
  `web/lib/spaces.ts:45-53`); routes map to `{ detail }`.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm typecheck`         | exit 0              |
| Unit      | `pnpm --filter @canopy/web test` | all pass |
| E2E       | `pnpm build && pnpm test:e2e -- --grep "spaces|folders|upload"` | all pass |

## Scope

**In scope**:
- `web/lib/vault-structure.ts`
- `web/lib/spaces.ts` (switch writers to the CAS helper)
- `web/lib/__tests__/vault-structure.test.ts` (create)
- `tests/e2e/spaces.spec.ts` (only if an assertion needs updating — see STOP)

**Out of scope**:
- `web/lib/s3.ts` / `web/lib/s3-mock.ts` — primitives already exist.
- `web/lib/folders.ts` — calls `ensureSpaceInStructure`/spaces functions; no
  direct structure writes; must keep working unchanged.
- The curate Lambda's manifest race — that's plans/008.
- `log-append.ts` / `usage-log.ts` — plans/011.

## Git workflow

- Branch: `advisor/007-structure-cas`
- Commit style: imperative, under 72 chars.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add an ETag-aware read and a CAS update helper

In `web/lib/vault-structure.ts`:

1. Add `getStructureWithETag(): Promise<{ structure: VaultStructure; etag: string | null }>`
   — same fallback ladder as `getStructure` (primary key with
   `getObjectWithETag`; legacy `structure.json` and the not-found default
   return `etag: null`, meaning "no CAS possible, first write creates").
2. Add the single write path all mutations go through:

   ```ts
   /**
    * Read-mutate-write structure.json with optimistic concurrency.
    * `mutate` receives a fresh structure and either mutates it in place and
    * returns true (write) or returns false (no-op, e.g. space already exists).
    * Retries the whole read+mutate on ConcurrencyError, up to 3 attempts.
    */
   export async function updateStructure(
     mutate: (structure: VaultStructure) => boolean | Promise<boolean>,
   ): Promise<VaultStructure> { … }
   ```

   Implementation: loop ≤3: `getStructureWithETag()` → `mutate(structure)` →
   if false, return structure → `putObject(STRUCTURE_KEY, json, etag ?? undefined)`
   → return; catch `ConcurrencyError` → continue; after 3 failures rethrow the
   `ConcurrencyError`.
   Caveat: when `etag === null` because the manifest doesn't exist yet, write
   WITHOUT `ifMatch` (a create); do not use `putObjectIfAbsent` here — two
   concurrent first-writes are resolved by the retry on the next loop.
3. Reimplement `ensureSpaceInStructure` on top: `updateStructure((s) => { const
   arr = mutableSpacesForScope(s, scope, userId); if (arr.some(e => e.name ===
   space)) return false; arr.push({...}); return true; })`.
4. Keep `putStructure` exported but mark it `@deprecated use updateStructure`
   (grep first: after Step 2 its only remaining callers should be none — if
   none remain, delete it instead).

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Move the three spaces.ts writers onto `updateStructure`

- `createSpace`: validation stays outside; existence check + push move into
  the mutate callback (throwing `SpaceError(409)` from inside the callback is
  fine — it aborts the CAS loop; ensure `updateStructure` doesn't swallow
  non-`ConcurrencyError` exceptions).
- `renameSpace`: the S3 re-key loop (lines 156-166) MUST stay outside/before
  the structure update — order of operations today is: re-key objects → move
  index file → update declaration → regenerate indexes. Preserve that order;
  only the `getStructure`/`putStructure` bracket around the declaration change
  (lines 145-153 + 177-179) collapses into one `updateStructure` call, which
  must re-locate the entry by `from` name inside the callback (the array index
  from a stale read is invalid after a retry).
- `deleteSpace`: same — S3 deletion stays put; the declaration splice moves
  into the callback with a fresh `findIndex`.

**Verify**: `pnpm typecheck` → exit 0; `pnpm build && pnpm test:e2e -- --grep "spaces|folders|upload"` → all pass.

### Step 3: Unit tests for the CAS loop

`web/lib/__tests__/vault-structure.test.ts` (vitest, `MOCK_S3=1` via
`vi.stubEnv` + `vi.resetModules()` so `s3.ts` picks the mock; the mock module
is stateful — read `web/lib/s3-mock.ts` `store()`/reset helpers first, and use
its seed/reset mechanism):

- happy path: `updateStructure` persists a mutation; second read sees it.
- no-op path: callback returns false → no write (mock put count unchanged).
- conflict path: simulate interleaving by calling `putObject(STRUCTURE_KEY, …)`
  directly between a stubbed first read and the CAS write — simplest: spy on
  the module's own first `putObject` attempt to throw `ConcurrencyError` once,
  then assert the final structure contains BOTH the concurrent change and the
  callback's change (the lost-update this plan fixes).
- exhaustion: `ConcurrencyError` thrown 3× → `updateStructure` rethrows.

**Verify**: `pnpm --filter @canopy/web test` → all pass.

## Test plan

As Step 3, plus the existing spaces/folders/upload e2e specs as the
integration gate. Model unit tests after the table-driven style from plan 004.

## Done criteria

- [ ] `pnpm typecheck` exits 0; unit + e2e suites pass
- [ ] `grep -rn "putStructure(" web/lib web/app | grep -v vault-structure.ts` → no callers outside the module (all writers go through `updateStructure`)
- [ ] The lost-update unit test exists and passes
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `putObject` `ifMatch` semantics differ in the mock vs real (a mock gap) —
  report rather than papering over.
- An e2e spec asserts on exact structure.json formatting that the CAS write
  changes (`JSON.stringify(structure, null, 2)` must stay).
- `renameSpace`'s ordering can't preserve "objects first, declaration second"
  under CAS without a behavior change — report the conflict.

## Maintenance notes

- Plan 008 applies the same pattern to the Lambda's `processed.json` — keep
  the helper shapes aligned so the pattern is recognizable in both codebases.
- Phase 6 multi-tenant load makes this race probable, not theoretical —
  reviewers should treat retry-loop correctness (fresh `findIndex` per
  attempt) as the review focus.
