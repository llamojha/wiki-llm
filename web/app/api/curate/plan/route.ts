import { NextResponse } from 'next/server';

import { getObject } from '@/lib/s3';
import { planPages } from '@/lib/ingest/plan';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { space, key } = body as { space?: string; key?: string };

  if (!space || !key) {
    return NextResponse.json({ detail: 'space and key are required' }, { status: 400 });
  }

  const rawContent = await getObject(key);

  let indexContent = '';
  try {
    indexContent = await getObject(`${space}/index.md`);
  } catch { /* no index yet */ }

  const plan = await planPages(rawContent, indexContent, key, space);

  return NextResponse.json({ plan });
}
