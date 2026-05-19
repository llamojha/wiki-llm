import { NextResponse } from 'next/server';
import { getObject, listObjects } from '@/lib/s3';
import { getIngestPolicy } from '@/lib/ingest-policy';
import { resolveScope, type Scope } from '@/lib/scope';
import { resolvePending, type ProcessedManifest } from '@/lib/curate-pending';

const SPACE_RE = /^[a-z0-9][a-z0-9-]*$/;

async function getManifest(
  systemKey: (name: string) => string,
  scopeName: Scope,
): Promise<ProcessedManifest> {
  try {
    const raw = await getObject(systemKey('processed.json'));
    return JSON.parse(raw);
  } catch {
    if (scopeName === 'shared') {
      try {
        const raw = await getObject('_processed.json');
        return JSON.parse(raw);
      } catch { /* fall through */ }
    }
    return { files: {} };
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const space = searchParams.get('space');
  const scopeName = (searchParams.get('scope') as Scope | null) ?? 'shared';
  const userId = searchParams.get('userId') ?? undefined;

  if (!space) {
    return NextResponse.json({ detail: 'space query param required' }, { status: 400 });
  }

  const scope = resolveScope({ scope: scopeName, userId });
  const policy = await getIngestPolicy(scope);
  if (!policy) {
    return NextResponse.json({ space, count: 0, keys: [], total: 0, detail: 'structure.json does not declare a generated wiki space' });
  }

  if (space !== policy.space) {
    return NextResponse.json({ space, count: 0, keys: [], total: 0, ingestSpace: policy.space });
  }

  if (!SPACE_RE.test(space)) {
    return NextResponse.json({ detail: 'invalid space name' }, { status: 400 });
  }

  const manifest = await getManifest(scope.systemKey, scope.scope);
  const keys = await listObjects(policy.rawPrefix);
  // Hash-aware pending detection — must agree with /api/curate/start so the
  // UI's "Pending: N" badge doesn't lie about re-uploaded files (it gates
  // the Process batch button via disabled={count === 0}).
  const pending = await resolvePending(keys, manifest);
  return NextResponse.json({
    space: policy.space,
    count: pending.length,
    keys: pending,
    total: keys.length,
    scope: scope.scope,
    userId: scope.userId,
  });
}
