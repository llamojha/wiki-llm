import { AppShell } from '@/components/app-shell';
import { type ApiTreeNode } from '@/lib/api';
import { getTree } from '@/lib/vault-tree';
import { FLAGS } from '@/lib/flags';

// The tree reflects current S3 contents; static prerendering would freeze it
// at build time. Force dynamic so every request re-reads the vault.
export const dynamic = 'force-dynamic';

export default async function Home() {
  let initialTree: ApiTreeNode[] = [];
  try {
    initialTree = await getTree();
  } catch {
    // S3 not reachable — AppShell renders with empty tree
  }
  return <AppShell initialTree={initialTree} flags={FLAGS} />;
}
