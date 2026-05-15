import { NextResponse } from 'next/server';

import { getObject, putObject } from '@/lib/s3';
import { generatePages } from '@/lib/ingest/generate';
import { appendLog } from '@/lib/log-append';
import type { PagePlanEntry } from '@/lib/ingest/plan';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { space, key, page } = body as { space?: string; key?: string; page?: PagePlanEntry };

  if (!space || !key || !page) {
    return NextResponse.json({ detail: 'space, key, and page are required' }, { status: 400 });
  }

  const rawContent = await getObject(key);
  const plan = { pages: [page] };
  const pages = await generatePages(plan, rawContent, key, space);

  for (const p of pages) {
    await putObject(p.key, p.content);
  }

  await appendLog('curated', key, `Generated "${page.title}" in ${space}`);

  return NextResponse.json({ generated: pages.map(p => ({ key: p.key, title: p.title })) });
}
