import { NextResponse } from 'next/server';
import { getObject, listObjects } from '@/lib/s3';
import { getIngestPolicy } from '@/lib/ingest-policy';
import { systemKey } from '@/lib/vault-paths';

const SPACE_RE = /^[a-z0-9][a-z0-9-]*$/;

type ProcessedManifest = { files: Record<string, unknown> };

async function getManifest(): Promise<ProcessedManifest> {
  try {
    const raw = await getObject(systemKey('processed.json'));
    return JSON.parse(raw);
  } catch {
    try {
      const raw = await getObject('_processed.json');
      return JSON.parse(raw);
    } catch {
      return { files: {} };
    }
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const space = searchParams.get('space');

  if (!space) {
    return NextResponse.json({ detail: 'space query param required' }, { status: 400 });
  }

  const policy = await getIngestPolicy();
  if (!policy) {
    return NextResponse.json({ space, count: 0, keys: [], total: 0, detail: 'structure.json does not declare a generated wiki space' });
  }

  if (space !== policy.space) {
    return NextResponse.json({ space, count: 0, keys: [], total: 0, ingestSpace: policy.space });
  }

  const manifest = await getManifest();

  if (!SPACE_RE.test(space)) {
    return NextResponse.json({ detail: 'invalid space name' }, { status: 400 });
  }

  const keys = await listObjects(policy.rawPrefix);
  const pending = keys.filter(k => !manifest.files[k]);
  return NextResponse.json({ space: policy.space, count: pending.length, keys: pending, total: keys.length });
}
