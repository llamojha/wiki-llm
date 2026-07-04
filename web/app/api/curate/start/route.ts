import { NextResponse } from 'next/server';
import { LambdaClient, InvokeCommand, InvocationType } from '@aws-sdk/client-lambda';
import { getObject, headObject, listAllKeys, listObjects, putObject } from '@/lib/s3';
import { getIngestPolicy } from '@/lib/ingest-policy';
import { type Scope } from '@/lib/scope';
import { resolveScopeOr400 } from '@/lib/http-scope';
import { resolvePending, type ProcessedManifest } from '@/lib/curate-pending';
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

  // Refuse to start a second job while one is already processing this scope —
  // overlapping jobs read the same manifest baseline and re-curate files the
  // other already finished. The client can poll the returned jobId instead.
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
