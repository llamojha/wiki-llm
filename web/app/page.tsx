import { AppShell } from '@/components/app-shell';
import { getTree, type ApiTreeNode } from '@/lib/api';

export default async function Home() {
  let initialTree: ApiTreeNode[] = [];
  try {
    initialTree = await getTree();
  } catch {
    // API not reachable — AppShell falls back to mock data
  }
  return <AppShell initialTree={initialTree} />;
}
