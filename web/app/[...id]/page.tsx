import { AppShell } from '@/components/app-shell';
import { type ApiTreeNode } from '@/lib/api';
import { getTree } from '@/lib/vault-tree';

export default async function DocPage({
  params,
}: {
  params: Promise<{ id: string[] }>;
}) {
  const { id } = await params;
  const docId = decodeURIComponent(id.join('/'));

  let initialTree: ApiTreeNode[] = [];
  try {
    initialTree = await getTree();
  } catch {
    // S3 not reachable
  }

  return <AppShell initialTree={initialTree} initialDocId={docId} />;
}
