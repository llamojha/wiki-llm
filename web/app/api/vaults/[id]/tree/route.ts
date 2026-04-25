import { NextResponse } from 'next/server';

import { getTree } from '@/lib/vault-tree';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const vaultId = process.env.VAULT_ID ?? 'default';
  if (id !== vaultId) {
    return NextResponse.json({ detail: 'Vault not found' }, { status: 404 });
  }
  const tree = await getTree();
  return NextResponse.json(tree);
}
