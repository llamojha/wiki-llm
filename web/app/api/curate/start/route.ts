import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { LambdaClient, InvokeCommand, InvocationType } from '@aws-sdk/client-lambda';
import { getObject, listObjects, putObject } from '@/lib/s3';
import { getIngestPolicy } from '@/lib/ingest-policy';
import { resolveScope, type Scope } from '@/lib/scope';

const LAMBDA_ARN = process.env.CURATE_LAMBDA_ARN;
const BUCKET = process.env.VAULT_BUCKET ?? '';
const PREFIX = process.env.VAULT_PREFIX ?? '';
const LAMBDA_REGION = process.env.CURATE_LAMBDA_REGION ?? 'eu-central-1';

let _lambda: LambdaClient | null = null;
function lambdaClient(): LambdaClient {
  if (!_lambda) _lambda = new LambdaClient({ region: LAMBDA_REGION });
  return _lambda;
}

type ProcessedManifest = { files: Record<string, { hash: string }> };

function computeHash(content: string): string {
  return 'sha256:' + createHash('sha256').update(content).digest('hex');
}

/**
 * Resolve which raw keys are pending curation. A key is pending if:
 *   - it has no entry in the manifest yet (new file), or
 *   - it has an entry but the current content hash differs (file was
 *     re-uploaded with new contents).
 *
 * Key-only detection misses the re-upload case because the manifest still
 * carries the old hash for the same key, so the file would be silently
 * dropped from the pending set. Hash-checking only the previously-seen keys
 * keeps the cost proportional to the manifest size, not the new-file count.
 */
async function resolvePending(
  allKeys: string[],
  manifest: ProcessedManifest,
): Promise<string[]> {
  const newKeys: string[] = [];
  const possiblyStale: string[] = [];
  for (const k of allKeys) {
    if (manifest.files[k]) possiblyStale.push(k);
    else newKeys.push(k);
  }

  // Re-hash known keys in parallel. Read failures are treated as "include
  // it, the Lambda will surface a clearer error if the object is gone."
  const modified: string[] = [];
  await Promise.all(
    possiblyStale.map(async (k) => {
      try {
        const content = await getObject(k);
        if (computeHash(content) !== manifest.files[k].hash) {
          modified.push(k);
        }
      } catch {
        modified.push(k);
      }
    }),
  );

  return [...newKeys, ...modified].sort();
}

export async function POST(req: Request) {
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

  const scope = resolveScope({ scope: scopeName ?? 'shared', userId });

  const policy = await getIngestPolicy(scope);
  if (!policy) {
    return NextResponse.json({ detail: 'structure.json does not declare a generated wiki space' }, { status: 409 });
  }

  if (space !== policy.space) {
    return NextResponse.json({ detail: `curation currently only supports the ${policy.space} space` }, { status: 400 });
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
  const payload = {
    jobId,
    space: policy.space,
    files: selected,
    bucket: BUCKET,
    prefix: PREFIX,
    scope: scope.scope,
    userId: scope.userId,
  };
  try {
    await lambdaClient().send(new InvokeCommand({
      FunctionName: LAMBDA_ARN,
      InvocationType: InvocationType.Event,
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Lambda invocation failed';
    await putObject(jobKey, JSON.stringify({
      ...job,
      status: 'error',
      completedAt: new Date().toISOString(),
      error: message,
    }, null, 2));
    return NextResponse.json({ detail: message, jobId }, { status: 502 });
  }

  return NextResponse.json({
    jobId,
    total: selected.length,
    remaining: pending.length - selected.length,
    scope: scope.scope,
    userId: scope.userId,
  });
}
