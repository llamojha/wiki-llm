import { NextResponse } from 'next/server';
import { getObject, listObjects } from '@/lib/s3';

const SPACE_RE = /^[a-z0-9][a-z0-9-]*$/;
const INGEST_SPACE = 'wiki';

type ProcessedManifest = { files: Record<string, unknown> };

async function getManifest(): Promise<ProcessedManifest> {
  try {
    const raw = await getObject('_processed.json');
    return JSON.parse(raw);
  } catch { return { files: {} }; }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const space = searchParams.get('space');

  if (!space) {
    return NextResponse.json({ detail: 'space query param required' }, { status: 400 });
  }

  if (space !== INGEST_SPACE) {
    return NextResponse.json({ space, count: 0, keys: [], total: 0, ingestSpace: INGEST_SPACE });
  }

  const manifest = await getManifest();

  if (!SPACE_RE.test(space)) {
    return NextResponse.json({ detail: 'invalid space name' }, { status: 400 });
  }

  const keys = await listObjects(`${INGEST_SPACE}/raw/`);
  const pending = keys.filter(k => !manifest.files[k]);
  return NextResponse.json({ space: INGEST_SPACE, count: pending.length, keys: pending, total: keys.length });
}
