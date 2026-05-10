import { NextResponse } from 'next/server';

import { runCuration } from '@/lib/ingest/run';
import { regenerateMasterIndex, regenerateSpaceIndex } from '@/lib/index-gen';
import { listObjects } from '@/lib/s3';

const SPACE_RE = /^[a-z0-9][a-z0-9-]*$/;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { space, key } = body as { space?: string; key?: string };

  if (!space) {
    return NextResponse.json({ detail: 'space is required' }, { status: 400 });
  }

  if (!SPACE_RE.test(space)) {
    return NextResponse.json(
      { detail: 'space must be lowercase alphanumeric with hyphens only' },
      { status: 400 },
    );
  }

  if (key && !key.startsWith(`${space}/raw/`)) {
    return NextResponse.json(
      { detail: `key must start with ${space}/raw/` },
      { status: 400 },
    );
  }

  const keys = key ? [key] : await listObjects(`${space}/raw/`);

  if (keys.length === 0) {
    return NextResponse.json(
      { detail: `no files found in ${space}/raw/` },
      { status: 404 },
    );
  }

  const results = [];
  for (const rawKey of keys) {
    try {
      const result = await runCuration(space, rawKey);
      results.push({
        rawKey,
        pages: result.pages.map((p) => ({ key: p.key, title: p.title })),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      results.push({ rawKey, error: message });
    }
  }

  // Regen indexes once at the end
  await regenerateSpaceIndex(space);
  await regenerateMasterIndex();

  return NextResponse.json({ space, results });
}
