import { NextResponse } from 'next/server';
import { getObject, listObjects } from '@/lib/s3';
import { getIngestPolicy } from '@/lib/ingest-policy';
import { resolveScope, type Scope } from '@/lib/scope';

const SPACE_RE = /^[a-z0-9][a-z0-9-]*$/;

type ProcessedManifest = { files: Record<string, unknown> };

async function getManifest(systemKey: (name: string) => string, scopeName: Scope): Promise<ProcessedManifest> {
  try {
    const raw = await getObject(systemKey('processed.json'));
    return JSON.parse(raw);
  } catch {
    // Legacy fallback only on shared scope.
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

  const manifest = await getManifest(scope.systemKey, scope.scope);

  if (!SPACE_RE.test(space)) {
    return NextResponse.json({ detail: 'invalid space name' }, { status: 400 });
  }

  const keys = await listObjects(policy.rawPrefix);
  const pending = keys.filter(k => !manifest.files[k]);
  return NextResponse.json({
    space: policy.space,
    count: pending.length,
    keys: pending,
    total: keys.length,
    scope: scope.scope,
    userId: scope.userId,
  });
}
