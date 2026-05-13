import { NextResponse } from 'next/server';

import { regenerateMasterIndex, regenerateSpaceIndex } from '@/lib/index-gen';
import { listSpaces } from '@/lib/s3';

const SPACE_RE = /^[a-z0-9][a-z0-9-]*$/;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { space } = body as { space?: string };

  if (space && !SPACE_RE.test(space)) {
    return NextResponse.json({ detail: 'invalid space name' }, { status: 400 });
  }

  if (space) {
    await regenerateSpaceIndex(space);
  } else {
    const spaces = await listSpaces();
    for (const s of spaces) {
      await regenerateSpaceIndex(s);
    }
  }
  await regenerateMasterIndex();

  return NextResponse.json({ ok: true });
}
