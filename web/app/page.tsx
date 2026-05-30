import { AppShell } from '@/components/app-shell';
import { type ApiTreeNode } from '@/lib/api';
import { getTree } from '@/lib/vault-tree';
import { FLAGS } from '@/lib/flags';

export default async function Home() {
  let initialTree: ApiTreeNode[] = [];
  try {
    initialTree = await getTree();
  } catch {
    // S3 not reachable — AppShell renders with empty tree
  }
  return <AppShell initialTree={initialTree} flags={FLAGS} />;
}
