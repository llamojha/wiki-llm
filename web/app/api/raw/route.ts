import { NextResponse } from 'next/server';
import { listObjects } from '@/lib/s3';

const SPACE_RE = /^[a-z0-9][a-z0-9-]*$/;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const space = searchParams.get('space');

  if (!space) {
    return NextResponse.json({ detail: 'space query param required' }, { status: 400 });
  }

  if (!SPACE_RE.test(space)) {
    return NextResponse.json({ detail: 'invalid space name' }, { status: 400 });
  }

  const keys = await listObjects(`${space}/raw/`);
  return NextResponse.json({ space, count: keys.length, keys });
}
