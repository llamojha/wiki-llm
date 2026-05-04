import { NextRequest, NextResponse } from 'next/server';

import { search } from '@/lib/search';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  if (!q.trim()) {
    return NextResponse.json([]);
  }
  const results = await search(q);
  return NextResponse.json(results);
}
