import { NextResponse } from 'next/server';
import { getObject, listObjects } from '@/lib/s3';
import { getStructure } from '@/lib/vault-structure';

const SPACE_RE = /^[a-z0-9][a-z0-9-]*$/;

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

  const manifest = await getManifest();

  if (space === '__all') {
    const structure = await getStructure();
    let allKeys: string[] = [];
    allKeys.push(...await listObjects('raw/'));
    for (const s of structure.spaces) {
      allKeys.push(...await listObjects(`${s.name}/raw/`));
    }
    const pending = allKeys.filter(k => !manifest.files[k]);
    return NextResponse.json({ space: '__all', count: pending.length, keys: pending, total: allKeys.length });
  }

  if (!SPACE_RE.test(space)) {
    return NextResponse.json({ detail: 'invalid space name' }, { status: 400 });
  }

  const keys = await listObjects(`${space}/raw/`);
  const pending = keys.filter(k => !manifest.files[k]);
  return NextResponse.json({ space, count: pending.length, keys: pending, total: keys.length });
}
