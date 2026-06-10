import { NextResponse } from 'next/server';
import { LambdaClient, InvokeCommand, InvocationType } from '@aws-sdk/client-lambda';

import { getIngestPolicy } from '@/lib/ingest-policy';
import { resolveScope, type Scope } from '@/lib/scope';
import { flagGuard } from '@/lib/flags';

/**
 * POST /api/synthesize — launches a SYNTHESIZE job on the curate Lambda.
 *
 * See specs/synthesis-pipeline.md. Mirrors the curate/start launch shape but
 * carries no per-file list — the Lambda reads source-cards directly from
 * `_system/source-cards/` in the target scope.
 *
 * Body:
 *   { space: string, scope?: 'shared'|'user', userId?: string }
 *
 * Returned 202 with the synthesis jobId on successful invocation. Polling
 * for synthesis progress isn't implemented yet (the Lambda logs stats and
 * writes the synthesis manifest as it goes); a status endpoint can come
 * later if a UI surface needs it.
 */

const LAMBDA_ARN = process.env.CURATE_LAMBDA_ARN;
const BUCKET = process.env.VAULT_BUCKET ?? '';
const PREFIX = process.env.VAULT_PREFIX ?? '';
const LAMBDA_REGION = process.env.CURATE_LAMBDA_REGION ?? 'eu-central-1';

let _lambda: LambdaClient | null = null;
function lambdaClient(): LambdaClient {
  if (!_lambda) _lambda = new LambdaClient({ region: LAMBDA_REGION });
  return _lambda;
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
  const { space, scope: scopeName, userId } = body as {
    space?: string;
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
    return NextResponse.json({ detail: `synthesis currently only supports the ${policy.space} space` }, { status: 400 });
  }

  const jobId = `synth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    curateEventVersion: 2,
    action: 'SYNTHESIZE',
    jobId,
    space: policy.space,
    files: [],
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
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lambda invocation failed';
    return NextResponse.json({ detail: message, jobId }, { status: 502 });
  }

  return NextResponse.json(
    { jobId, scope: scope.scope, userId: scope.userId },
    { status: 202 },
  );
}
