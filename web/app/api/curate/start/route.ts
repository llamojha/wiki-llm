import { NextResponse } from 'next/server';
import { LambdaClient, InvokeCommand, InvocationType } from '@aws-sdk/client-lambda';
import { getObject, listObjects, putObject } from '@/lib/s3';

const LAMBDA_ARN = process.env.CURATE_LAMBDA_ARN;
const BUCKET = process.env.VAULT_BUCKET ?? '';
const PREFIX = process.env.VAULT_PREFIX ?? '';
const REGION = process.env.VAULT_REGION ?? 'eu-central-1';
const LAMBDA_REGION = process.env.CURATE_LAMBDA_REGION ?? 'eu-central-1';

let _lambda: LambdaClient | null = null;
function lambdaClient(): LambdaClient {
  if (!_lambda) _lambda = new LambdaClient({ region: LAMBDA_REGION });
  return _lambda;
}

type ProcessedManifest = { files: Record<string, { hash: string }> };

export async function POST(req: Request) {
  if (!LAMBDA_ARN) {
    return NextResponse.json({ detail: 'CURATE_LAMBDA_ARN not configured' }, { status: 500 });
  }
  if (!BUCKET) {
    return NextResponse.json({ detail: 'VAULT_BUCKET not configured' }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const { space } = body as { space?: string };

  if (!space) {
    return NextResponse.json({ detail: 'space is required' }, { status: 400 });
  }

  // List raw files for this space
  const rawPrefix = space === '__all' ? 'raw/' : `${space}/raw/`;
  const allKeys = await listObjects(rawPrefix);

  if (allKeys.length === 0) {
    return NextResponse.json({ detail: 'no raw files found' }, { status: 404 });
  }

  // Read manifest and filter to pending only
  let manifest: ProcessedManifest = { files: {} };
  try {
    const raw = await getObject('_processed.json');
    manifest = JSON.parse(raw);
  } catch { /* no manifest yet */ }

  // For pending detection, we just check if the key exists in manifest
  // (full hash comparison happens in Lambda)
  const pending = allKeys.filter(k => !manifest.files[k]);

  if (pending.length === 0) {
    return NextResponse.json({ detail: 'all files already processed' }, { status: 200 });
  }

  // Create job
  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id: jobId,
    status: 'processing',
    space,
    total: pending.length,
    completed: 0,
    files: pending.map(key => ({ key, status: 'pending' })),
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };

  await putObject(`_jobs/${jobId}.json`, JSON.stringify(job, null, 2));

  // Invoke Lambda async
  const payload = { jobId, space, files: pending, bucket: BUCKET, prefix: PREFIX };
  await lambdaClient().send(new InvokeCommand({
    FunctionName: LAMBDA_ARN,
    InvocationType: InvocationType.Event, // async
    Payload: new TextEncoder().encode(JSON.stringify(payload)),
  }));

  return NextResponse.json({ jobId, total: pending.length });
}
