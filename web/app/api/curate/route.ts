import { NextResponse } from 'next/server';

// Legacy route — the UI now calls /api/curate/start directly.
// Kept as a thin redirect for any external callers.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { space } = body as { space?: string };

  if (!space) {
    return NextResponse.json({ detail: 'space is required' }, { status: 400 });
  }

  // Import and call the start handler logic directly (avoid self-fetch on Vercel)
  const { POST: startHandler } = await import('./start/route');
  const fakeReq = new Request(req.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ space }),
  });
  return startHandler(fakeReq);
}
