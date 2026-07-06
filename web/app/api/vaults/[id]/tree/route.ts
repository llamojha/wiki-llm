import { NextResponse } from 'next/server';

import { getTree } from '@/lib/vault-tree';
import { requireSession } from '@/lib/auth-guard';

// The tree is built from live S3 contents but the handler's only
// request-derived input is the route segment param — which does NOT opt the
// route out of Next.js 16's default static caching. Without this, the response
// is frozen at first request (e.g. an empty vault stays empty until redeploy).
// Force per-request evaluation so the tree always reflects current S3 state.
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireSession(req);
  if (gate) return gate;
  const { id } = await params;
  const vaultId = process.env.VAULT_ID ?? 'default';
  if (id !== vaultId) {
    return NextResponse.json({ detail: 'Vault not found' }, { status: 404 });
  }
  const tree = await getTree();
  return NextResponse.json(tree);
}
