import { NextResponse } from 'next/server';
import { listObjects } from '@/lib/s3';
import { getStructure } from '@/lib/vault-structure';

const SPACE_RE = /^[a-z0-9][a-z0-9-]*$/;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const space = searchParams.get('space');

  if (!space) {
    return NextResponse.json({ detail: 'space query param required' }, { status: 400 });
  }

  if (space === '__all') {
    // Count raw files across all spaces + root raw/
    const structure = await getStructure();
    let allKeys: string[] = [];

    // Root-level raw/
    allKeys.push(...await listObjects('raw/'));

    // Per-space raw/
    if (structure.spaces.length > 0) {
      for (const s of structure.spaces) {
        allKeys.push(...await listObjects(`${s.name}/raw/`));
      }
    }

    return NextResponse.json({ space: '__all', count: allKeys.length, keys: allKeys });
  }

  if (!SPACE_RE.test(space)) {
    return NextResponse.json({ detail: 'invalid space name' }, { status: 400 });
  }

  const keys = await listObjects(`${space}/raw/`);
  return NextResponse.json({ space, count: keys.length, keys });
}
