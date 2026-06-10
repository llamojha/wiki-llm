import { NextResponse } from 'next/server';

import { __dump, __resetWith } from '@/lib/s3-mock';
import { invalidateSearchIndex } from '@/lib/search';

/**
 * Test-only seed/dump endpoint. Available only when `MOCK_S3=1`. Used by the
 * Playwright e2e suite to reset the in-memory vault between tests and seed
 * fixtures before driving the UI.
 */

function guard(): NextResponse | null {
  const enabled = process.env.MOCK_S3 === '1' || process.env.MOCK_S3 === 'true';
  if (!enabled) {
    return NextResponse.json({ detail: 'mock mode disabled' }, { status: 404 });
  }
  return null;
}

export async function POST(req: Request) {
  const blocked = guard();
  if (blocked) return blocked;
  const body = (await req.json().catch(() => ({}))) as { seed?: Record<string, string> };
  __resetWith(body.seed ?? {});
  invalidateSearchIndex();
  return NextResponse.json({ ok: true, count: Object.keys(body.seed ?? {}).length });
}

export async function GET() {
  const blocked = guard();
  if (blocked) return blocked;
  return NextResponse.json(__dump());
}
