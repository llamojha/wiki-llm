import { NextRequest, NextResponse } from 'next/server';

import { searchScoped, type SearchScope } from '@/lib/search';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  const scope = (req.nextUrl.searchParams.get('scope') ?? 'both') as SearchScope;
  const userId = req.nextUrl.searchParams.get('userId') ?? undefined;
  const folder = req.nextUrl.searchParams.get('folder') ?? undefined;
  if (!q.trim()) {
    return NextResponse.json([]);
  }
  if (!['shared', 'user', 'both'].includes(scope)) {
    return NextResponse.json({ detail: 'invalid scope' }, { status: 400 });
  }
  const results = await searchScoped(q, 20, { scope, userId, folder });
  return NextResponse.json(results);
}
