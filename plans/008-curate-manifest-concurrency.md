# Plan 008: Guard the curate Lambda's processed.json against overlapping jobs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- infra/lambda/curate/ web/app/api/curate/start/route.ts`
> On drift, compare "Current state" excerpts against live code; on mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (cross-invocation coordination on S3)
- **Depends on**: none (pattern-aligned with plans/007 — read it if already landed)
- **Category**: bug
- **Planned at**: commit `fead8f9`, 2026-07-03

## Why this matters

The curate pipeline records which raw files have been processed in a per-scope
`_system/processed.json`. The Lambda serializes manifest writes **within one
invocation** (a write queue), but `POST /api/curate/start` invokes the Lambda
per job with no per-scope lock: two overlapping jobs (or a manual re-run while
one is processing) each read the same manifest baseline and the last writer
wins. Dropped entries make already-curated raw files look pending again and
they get re-processed — duplicate generated pages and wasted Bedrock spend.

## Current state

- `infra/lambda/curate/manifest.ts` — plain read-modify-write:

  ```ts
  export async function getManifest(bucket, prefix, scope): Promise<ProcessedManifest> {
    const primary = await getObjectOrNull(bucket, prefix, manifestKey(scope));
    if (primary) return JSON.parse(primary) as ProcessedManifest;
    // legacy `_processed.json` fallback (shared scope only)
    …
    return { files: {} };
  }

  export async function saveManifest(bucket, prefix, scope, manifest): Promise<void> {
    await putJson(bucket, prefix, manifestKey(scope), manifest);
  }
  ```

  `addToManifest` (lines 62-82) is pure — it returns a new manifest with one
  `files[rawKey]` entry merged. `manifestKey(scope)` = `scope.systemKey('processed.json')`.
- `infra/lambda/curate/index.ts` — `createWriteQueue()` (per-invocation);
  handler processes files and enqueues manifest saves through it.
- `infra/lambda/curate/ingest.ts` (~156-165) — the get→merge→save flow; its
  doc comment (~85-94) claims safety only for concurrent workers within one
  invocation.
- `infra/lambda/curate/s3.ts` — helper wrappers (`getObjectOrNull`, `putJson`);
  this is a **separate npm package** (not pnpm workspace) with its own jest
  suite: `cd infra/lambda/curate && npm run build && npm test`.
- Job state: the web route (`web/app/api/curate/start/route.ts`) writes
  `_system/jobs/<id>.json` then fire-and-forget invokes the Lambda (~lines
  138-143); status route polls the job file. There is no check for an
  already-running job in the same scope.
- The web app solves the identical problem with S3 conditional puts
  (`IfMatch` → 412 → `ConcurrencyError`) — see `web/lib/s3.ts:248-281`. AWS S3
  natively supports `IfMatch` on PutObject.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Lambda build | `cd infra/lambda/curate && npm run build` | exit 0 |
| Lambda tests | `cd infra/lambda/curate && npm test`      | all pass |
| Web typecheck | `pnpm typecheck` (repo root)             | exit 0 |
| Web e2e   | `pnpm build && pnpm test:e2e -- --grep curate` | all pass |

## Scope

**In scope**:
- `infra/lambda/curate/manifest.ts`, `infra/lambda/curate/s3.ts` (ETag support)
- `infra/lambda/curate/ingest.ts` / `index.ts` (retry-merge on conflict)
- `infra/lambda/curate/*.test.ts` (extend the existing jest suite)
- `web/app/api/curate/start/route.ts` (409 when a job is already processing)
- `tests/e2e/curate.spec.ts` (extend for the 409)

**Out of scope**:
- `web/lib/vault-structure.ts` (plans/007 territory)
- The Bedrock call path, page generation, XML parsing in the Lambda
- Job file schema changes beyond what Step 3 needs

## Git workflow

- Branch: `advisor/008-curate-manifest-cas`
- Commit style: imperative, under 72 chars. Lambda change and web-route change
  as separate commits.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: ETag-conditional manifest writes in the Lambda

In `infra/lambda/curate/s3.ts`, extend the helpers: `getObjectOrNull` gains an
ETag-returning variant (or add `getObjectWithETagOrNull`), and `putJson` gains
an optional `ifMatch` param that maps HTTP 412 / `PreconditionFailed` to a
thrown `ManifestConflictError` (new, exported from `manifest.ts` or `s3.ts`).
Mirror the detection logic used in `web/lib/s3.ts:274-279`
(`e.name === 'PreconditionFailed' || e.$metadata?.httpStatusCode === 412`).

In `manifest.ts`, add:

```ts
/**
 * Merge one entry into the manifest with compare-and-swap + retry (≤5).
 * Re-reads the manifest on conflict so concurrent invocations' entries merge
 * instead of last-writer-wins.
 */
export async function mergeIntoManifest(
  bucket: string, prefix: string, scope: ScopePaths,
  rawKey: string, entry: ProcessedManifest['files'][string],
): Promise<void> { … }
```

Loop: read manifest+etag (null etag when absent/legacy — first write is
unconditional) → merge entry (reuse `addToManifest`'s spread shape) → put with
`ifMatch` → done; on `ManifestConflictError`, retry with fresh read.

**Verify**: `cd infra/lambda/curate && npm run build && npm test` → pass
(existing tests may need their mocks extended for the ETag variant — that IS
in scope).

### Step 2: Route ingest through the merge

In `ingest.ts`/`index.ts`, replace the get→`addToManifest`→`saveManifest`
sequence with `mergeIntoManifest` per processed file. The per-invocation write
queue can remain (it reduces intra-invocation conflict retries) — but the
queue's writes now go through CAS. Update the stale doc comment (~ingest.ts:85-94)
to state cross-invocation safety.

**Verify**: `npm test` in the Lambda dir → all pass, including new conflict tests:
- two `mergeIntoManifest` calls with a simulated 412 on the first attempt →
  final manifest contains both entries (the lost-update regression);
- retry exhaustion (always-412) → throws.
Model after the existing jest tests in the package.

### Step 3: Refuse overlapping jobs per scope in the start route

In `web/app/api/curate/start/route.ts`, before creating a new job: list/read
the scope's job files (the status route already knows how to read them — reuse
its helper from `web/lib/curate-pending.ts` if one exists; read that file
first) and if any job for this scope is in a non-terminal phase
(`processing`/equivalent — read the job JSON's phase vocabulary from the
status route before coding), return
`{ detail: 'a curate job is already running for this scope' }` with **409**.
Include the running job's id in the detail so the client can poll it.
Guard against stale jobs: treat a non-terminal job older than the Lambda's
5-minute timeout (use the job file's timestamp, threshold 10 min) as dead and
allow a new start.

**Verify**: `pnpm typecheck` → exit 0; `pnpm build && pnpm test:e2e -- --grep curate`
→ pass, plus a new e2e case: start a job (Lambda intercepted per-test as the
existing curate spec does), immediately POST start again → 409; after the
first completes → new start succeeds.

## Test plan

- Lambda jest: CAS merge under conflict (both entries survive), retry
  exhaustion, legacy-manifest first write.
- Web e2e: double-start → 409; stale-job override path if cheaply testable
  (otherwise note as untested in the plan index row).

## Done criteria

- [ ] `cd infra/lambda/curate && npm run build && npm test` exits 0 with the new conflict tests
- [ ] `grep -n "saveManifest" infra/lambda/curate/*.ts` → no remaining direct get→save read-modify-write in the ingest path
- [ ] `pnpm typecheck` exits 0; curate e2e passes incl. the 409 case
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The Lambda's S3 helpers or manifest flow differ materially from the excerpts
  (drift — this package moves fast).
- The job files carry no phase/timestamp usable for Step 3's staleness check —
  report the actual schema instead of extending it ad hoc.
- The deployed S3 provider for this Lambda doesn't honor `IfMatch` on
  PutObject (check for an S3-compatible-store assumption in the package docs).

## Maintenance notes

- This is deployed out-of-band (`CLAUDE.md`: "deployed out-of-band") — landing
  the code does NOT update the running Lambda; flag redeployment in the PR.
- If job orchestration ever moves to SQS/Step Functions (ROADMAP Phase 6
  notes S3-event-driven ingest), the 409 gate moves with it.
