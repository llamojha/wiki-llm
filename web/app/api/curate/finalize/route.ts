import { NextResponse } from 'next/server';

import { deleteObject } from '@/lib/s3';
import { regenerateMasterIndex, regenerateSpaceIndex } from '@/lib/index-gen';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { space, key, reindex } = body as { space?: string; key?: string; reindex?: boolean };

  if (!space || !key) {
    return NextResponse.json({ detail: 'space and key are required' }, { status: 400 });
  }

  await deleteObject(key);

  if (reindex) {
    await regenerateSpaceIndex(space);
    await regenerateMasterIndex();
  }

  return NextResponse.json({ done: true });
}
