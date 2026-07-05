import { NextResponse } from 'next/server';
import { LambdaClient, InvokeCommand, InvocationType } from '@aws-sdk/client-lambda';
import {
  ConcurrencyError,
  deleteObject,
  getObject,
  getObjectWithETag,
  headObject,
  listAllKeys,
  listObjects,
  ObjectAlreadyExistsError,
  putObject,
  putObjectIfAbsent,
} from '@/lib/s3';
import { getIngestPolicy, resolveFoldersIngest, isIngestError } from '@/lib/ingest-policy';
import { type Scope } from '@/lib/scope';
import { resolveScopeOr400 } from '@/lib/http-scope';
import { resolvePending, type ProcessedManifest } from '@/lib/curate-pending';
import { ensureVaultMode, vaultMode } from '@/lib/vault-mode';
import { isDocumentKey } from '@/lib/vault-paths';
import { flagGuard } from '@/lib/flags';

const LAMBDA_ARN = process.env.CURATE_LAMBDA_ARN;
const BUCKET = process.env.VAULT_BUCKET ?? '';
const PREFIX = process.env.VAULT_PREFIX ?? '';
const LAMBDA_REGION = process.env.CURATE_LAMBDA_REGION ?? 'eu-central-1';

// A `processing` job whose file has not been touched within this window is
// treated as dead (the Lambda times out at 5 min and heartbeats the job file
// every few seconds while working), so a new start is allowed. Anything more
// recent means a job is genuinely in flight → refuse with 409.
const STALE_JOB_MS = 10 * 60 * 1000;

/**
 * Whether the given scope already has a curate job actively processing. Scans
 * the scope's job files and, for any still marked `processing`, checks the
 * object's last-modified heartbeat against the staleness window. Returns the
 * live job's id, or null when the scope is free to start a new job.
 *
 * This is a best-effort scan used only to produce a friendly `jobId` in the
 * 409 body — the actual race is closed by `claimStartLock` below, which is
 * the sole authority on whether a new job may start.
 */
async function activeJobId(systemKey: (name: string) => string): Promise<string | null> {
  const keys = await listAllKeys(systemKey('jobs/'));
  for (const key of keys) {
    if (!key.endsWith('.json')) continue;
    let job: { id?: string; status?: string };
    try {
      job = JSON.parse(await getObject(key));
    } catch {
      continue; // unreadable/partial job file — ignore
    }
    if (job.status !== 'processing') continue;
    const meta = await headObject(key);
    const ageMs = meta.lastModified ? Date.now() - meta.lastModified.getTime() : Infinity;
    if (ageMs <= STALE_JOB_MS) return job.id ?? key;
  }
  return null;
}

type StartLock = { jobId: string; createdAt: string };

/**
 * Atomically claim the per-scope curate-start lock, or return the id of the
 * job already holding it.
 *
 * `activeJobId` above is only a scan-then-act check: two concurrent POSTs can
 * both observe no processing job and both proceed, each starting its own
 * Lambda invocation with the same manifest baseline. This closes that race
 * with a single atomic object (`jobs/.lock`):
 *
 * - `putObjectIfAbsent` succeeds → we're the only caller that could have
 *   created it this way; we hold the lock.
 * - It already exists → read the job it references. If that job is no longer
 *   `processing` (done/error/cancelled) or its heartbeat is older than
 *   `STALE_JOB_MS`, the lock is dead: steal it with a CAS `putObject` keyed to
 *   the stale lock's own ETag, so only one of any number of racing stealers
 *   wins. If the referenced job is genuinely live, return its id — the caller
 *   responds 409.
 *
 * Returns `null` when the lock is held by the caller (safe to start a job),
 * or the live job's id when another job is already in flight.
 */
async function claimStartLock(
  systemKey: (name: string) => string,
  jobId: string,
): Promise<string | null> {
  const lockKey = systemKey('jobs/.lock');
  const lockBody = JSON.stringify({ jobId, createdAt: new Date().toISOString() } satisfies StartLock);

  try {
    await putObjectIfAbsent(lockKey, lockBody);
    return null;
  } catch (err) {
    if (!(err instanceof ObjectAlreadyExistsError)) throw err;
  }

  let existing: { content: string; etag: string };
  try {
    existing = await getObjectWithETag(lockKey);
  } catch {
    // Deleted between our failed create and this read — retry the claim once.
    try {
      await putObjectIfAbsent(lockKey, lockBody);
      return null;
    } catch (err) {
      if (!(err instanceof ObjectAlreadyExistsError)) throw err;
      return 'unknown';
    }
  }

  let heldLock: StartLock;
  try {
    heldLock = JSON.parse(existing.content) as StartLock;
  } catch {
    heldLock = { jobId: 'unknown', createdAt: new Date(0).toISOString() };
  }

  const heldJobKey = systemKey(`jobs/${heldLock.jobId}.json`);
  let isLive = false;
  try {
    const job = JSON.parse(await getObject(heldJobKey)) as { status?: string };
    if (job.status === 'processing') {
      const meta = await headObject(heldJobKey);
      const ageMs = meta.lastModified ? Date.now() - meta.lastModified.getTime() : Infinity;
      isLive = ageMs <= STALE_JOB_MS;
    }
  } catch {
    isLive = false; // job file missing/unreadable — treat the lock as dead
  }

  if (isLive) return heldLock.jobId;

  // Dead lock — steal it. CAS on the stale lock's own ETag so, if several
  // requests race to steal simultaneously, only one succeeds; the losers loop
  // back through the live-check above (which will now see our fresh lock).
  try {
    await putObject(lockKey, lockBody, existing.etag);
    return null;
  } catch (err) {
    if (err instanceof ConcurrencyError) return heldLock.jobId;
    throw err;
  }
}

/**
 * Release the start lock if it still references `jobId`. Used when a job
 * fails to actually start (e.g. the Lambda invoke throws) so the scope isn't
 * blocked from starting a replacement job until `STALE_JOB_MS` elapses.
 * Guarded by a re-read so we never delete a lock a later caller has since
 * claimed for a different job.
 */
async function releaseStartLock(
  systemKey: (name: string) => string,
  jobId: string,
): Promise<void> {
  const lockKey = systemKey('jobs/.lock');
  try {
    const { content } = await getObjectWithETag(lockKey);
    const held = JSON.parse(content) as StartLock;
    if (held.jobId === jobId) await deleteObject(lockKey);
  } catch {
    // Already gone or unreadable — nothing to release.
  }
}

let _lambda: LambdaClient | null = null;
function lambdaClient(): LambdaClient {
  if (!_lambda) _lambda = new LambdaClient({ region: LAMBDA_REGION });
  return _lambda;
}

/**
 * FEATURE_CURATE_AUTOSYNTH — opt-in chain hook into synthesis after the
 * extraction batch completes. Default OFF (consistent with the resolved
 * decision in specs/synthesis-pipeline.md). Not in flags.ts because it has
 * no UI surface — it's a server-side runtime toggle, not a portal feature.
 */
function isAutosynthEnabled(): boolean {
  const raw = process.env.FEATURE_CURATE_AUTOSYNTH;
  if (raw == null) return false;
  const v = raw.trim().toLowerCase();
  return v === 'on' || v === '1' || v === 'true' || v === 'yes';
}


export async function POST(req: Request) {
  const blocked = flagGuard('curate');
  if (blocked) return blocked;

  if (!LAMBDA_ARN) {
    return NextResponse.json({ detail: 'CURATE_LAMBDA_ARN not configured' }, { status: 500 });
  }
  if (!BUCKET) {
    return NextResponse.json({ detail: 'VAULT_BUCKET not configured' }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));

  // Folders mode has no structure.json spaces or provenance roots: curation
  // reads a caller-chosen source folder and writes curated pages into a
  // caller-chosen destination folder, tagged `origin: generated` in
  // frontmatter (plan 026). Entirely separate contract from the provenance
  // flow below, which stays byte-identical.
  await ensureVaultMode();
  if (vaultMode() === 'folders') {
    return startFolders(body);
  }

  const { space, limit, scope: scopeName, userId } = body as {
    space?: string;
    limit?: unknown;
    scope?: Scope;
    userId?: string;
  };

  if (!space) {
    return NextResponse.json({ detail: 'space is required' }, { status: 400 });
  }

  const scope = resolveScopeOr400({ scope: scopeName ?? 'shared', userId });
  if (scope instanceof NextResponse) return scope;

  const policy = await getIngestPolicy(scope);
  if (!policy) {
    return NextResponse.json({ detail: 'structure.json does not declare a generated wiki space' }, { status: 409 });
  }

  if (space !== policy.space) {
    return NextResponse.json({ detail: `curation currently only supports the ${policy.space} space` }, { status: 400 });
  }

  // Fast-path 409 without doing the pending-files scan below — this is a
  // scan-then-act check only (see `activeJobId`'s docstring); the actual
  // guard against two concurrent starts is `claimStartLock`, applied right
  // before the job is created.
  const runningJobId = await activeJobId(scope.systemKey);
  if (runningJobId) {
    return NextResponse.json(
      { detail: 'a curate job is already running for this scope', jobId: runningJobId },
      { status: 409 },
    );
  }

  const batchLimit = typeof limit === 'number' && Number.isInteger(limit)
    ? limit
    : undefined;
  if (batchLimit !== undefined && batchLimit < 1) {
    return NextResponse.json({ detail: 'limit must be a positive integer' }, { status: 400 });
  }

  // Read raw files from the scoped raw prefix.
  const allKeys = await listObjects(policy.rawPrefix);

  if (allKeys.length === 0) {
    return NextResponse.json({ detail: 'no raw files found' }, { status: 404 });
  }

  // Read scope's manifest and filter to pending only.
  let manifest: ProcessedManifest = { files: {} };
  try {
    const raw = await getObject(scope.systemKey('processed.json'));
    manifest = JSON.parse(raw);
  } catch {
    // Legacy fallback only on shared scope — see Lambda manifest.ts for the same logic.
    if (scope.scope === 'shared') {
      try {
        const raw = await getObject('_processed.json');
        manifest = JSON.parse(raw);
      } catch { /* no manifest yet */ }
    }
  }

  const pending = await resolvePending(allKeys, manifest);

  if (pending.length === 0) {
    return NextResponse.json({ detail: 'all files already processed' }, { status: 200 });
  }

  const selected = batchLimit ? pending.slice(0, batchLimit) : pending;

  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Atomically claim the per-scope start lock before writing the job file.
  // This is the actual guard against two concurrent POSTs both passing the
  // `activeJobId` scan above and both starting a job — see `claimStartLock`.
  const lockHolderJobId = await claimStartLock(scope.systemKey, jobId);
  if (lockHolderJobId) {
    return NextResponse.json(
      { detail: 'a curate job is already running for this scope', jobId: lockHolderJobId },
      { status: 409 },
    );
  }

  const job = {
    id: jobId,
    status: 'processing',
    space: policy.space,
    scope: scope.scope,
    userId: scope.userId,
    total: selected.length,
    completed: 0,
    files: selected.map(key => ({ key, status: 'pending' })),
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };

  const jobKey = scope.systemKey(`jobs/${jobId}.json`);
  await putObject(jobKey, JSON.stringify(job, null, 2));

  // Lambda payload carries scope so the Lambda can resolve the same paths.
  // FEATURE_CURATE_AUTOSYNTH (default off) opts the batch into auto-chaining
  // a SYNTHESIZE invocation after extraction completes — see
  // specs/synthesis-pipeline.md (resolved decision #3).
  const payload = {
    curateEventVersion: 2,
    jobId,
    space: policy.space,
    files: selected,
    bucket: BUCKET,
    prefix: PREFIX,
    scope: scope.scope,
    userId: scope.userId,
    autoSynthesize: isAutosynthEnabled(),
  };
  try {
    await lambdaClient().send(new InvokeCommand({
      FunctionName: LAMBDA_ARN,
      InvocationType: InvocationType.Event,
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Lambda invocation failed';
    // Retain the SDK detail server-side (server log + the job's own error
    // field in _system/), but return a generic detail to the client so ARNs,
    // region, and internal reasons don't leak into the response body.
    console.error('[curate] lambda invoke failed:', err);
    await putObject(jobKey, JSON.stringify({
      ...job,
      status: 'error',
      completedAt: new Date().toISOString(),
      error: message,
    }, null, 2));
    // Release the lock immediately since no Lambda is running to hold it —
    // otherwise the scope would be blocked from starting a new job until
    // STALE_JOB_MS elapses even though nothing is actually in flight.
    await releaseStartLock(scope.systemKey, jobId);
    return NextResponse.json({ detail: 'curation failed to start', jobId }, { status: 502 });
  }

  return NextResponse.json({
    jobId,
    total: selected.length,
    remaining: pending.length - selected.length,
    scope: scope.scope,
    userId: scope.userId,
  });
}

/**
 * Folders-mode curate start (plan 026, `curateEventVersion: 3`).
 *
 * Reads ordinary user documents from a caller-chosen **source** folder and
 * dispatches the Lambda to write curated pages into a caller-chosen
 * **destination** folder, each stamped `origin: generated` in frontmatter — no
 * `structure.json` space, no `generated/`/`raw/` roots, no `_vaultmark/`. The
 * vault is single-tenant in folders mode, so the shared scope's `_system/`
 * owns the job files, start-lock, and processed manifest.
 */
async function startFolders(body: unknown): Promise<NextResponse> {
  if (!LAMBDA_ARN) {
    return NextResponse.json({ detail: 'CURATE_LAMBDA_ARN not configured' }, { status: 500 });
  }
  const { source, destination, limit } = (body ?? {}) as {
    source?: unknown;
    destination?: unknown;
    limit?: unknown;
  };

  const policy = resolveFoldersIngest(
    typeof source === 'string' ? source : '',
    typeof destination === 'string' ? destination : '',
  );
  if (isIngestError(policy)) {
    return NextResponse.json({ detail: policy.error }, { status: 400 });
  }

  const batchLimit = typeof limit === 'number' && Number.isInteger(limit) ? limit : undefined;
  if (batchLimit !== undefined && batchLimit < 1) {
    return NextResponse.json({ detail: 'limit must be a positive integer' }, { status: 400 });
  }

  // Single-tenant: shared scope owns `_system/` (jobs, lock, manifest).
  const scope = resolveScopeOr400({ scope: 'shared' });
  if (scope instanceof NextResponse) return scope;

  const runningJobId = await activeJobId(scope.systemKey);
  if (runningJobId) {
    return NextResponse.json(
      { detail: 'a curate job is already running', jobId: runningJobId },
      { status: 409 },
    );
  }

  // Recognized documents under the source folder, excluding the destination
  // subtree so curation never re-ingests its own generated output.
  const destPrefix = `${policy.destination}/`;
  const sourceKeys = (await listObjects(policy.sourcePrefix)).filter(
    (key) => isDocumentKey(key) && !key.startsWith(destPrefix),
  );

  if (sourceKeys.length === 0) {
    return NextResponse.json({ detail: 'no source documents found' }, { status: 404 });
  }

  let manifest: ProcessedManifest = { files: {} };
  try {
    manifest = JSON.parse(await getObject(scope.systemKey('processed.json')));
  } catch {
    // No manifest yet — everything is pending.
  }

  const pending = await resolvePending(sourceKeys, manifest);
  if (pending.length === 0) {
    return NextResponse.json({ detail: 'all source documents already processed' }, { status: 200 });
  }

  const selected = batchLimit ? pending.slice(0, batchLimit) : pending;
  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const lockHolderJobId = await claimStartLock(scope.systemKey, jobId);
  if (lockHolderJobId) {
    return NextResponse.json(
      { detail: 'a curate job is already running', jobId: lockHolderJobId },
      { status: 409 },
    );
  }

  const job = {
    id: jobId,
    status: 'processing',
    mode: 'folders',
    source: policy.source,
    destination: policy.destination,
    // `space` carries the destination for the job/finalize machinery, which is
    // otherwise space-shaped; folders finalize ignores it beyond labelling.
    space: policy.destination,
    scope: scope.scope,
    userId: scope.userId,
    total: selected.length,
    completed: 0,
    files: selected.map((key) => ({ key, status: 'pending' })),
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };

  const jobKey = scope.systemKey(`jobs/${jobId}.json`);
  await putObject(jobKey, JSON.stringify(job, null, 2));

  const payload = {
    curateEventVersion: 3,
    mode: 'folders',
    jobId,
    source: policy.source,
    destination: policy.destination,
    space: policy.destination,
    files: selected,
    bucket: BUCKET,
    prefix: PREFIX,
    scope: scope.scope,
  };
  try {
    await lambdaClient().send(new InvokeCommand({
      FunctionName: LAMBDA_ARN,
      InvocationType: InvocationType.Event,
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Lambda invocation failed';
    console.error('[curate] lambda invoke failed:', err);
    await putObject(jobKey, JSON.stringify({
      ...job,
      status: 'error',
      completedAt: new Date().toISOString(),
      error: message,
    }, null, 2));
    await releaseStartLock(scope.systemKey, jobId);
    return NextResponse.json({ detail: 'curation failed to start', jobId }, { status: 502 });
  }

  return NextResponse.json({
    jobId,
    total: selected.length,
    remaining: pending.length - selected.length,
    source: policy.source,
    destination: policy.destination,
  });
}
