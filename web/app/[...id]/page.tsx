import { AppShell } from '@/components/app-shell';
import { type ApiTreeNode } from '@/lib/api';
import { getTree } from '@/lib/vault-tree';
import { FLAGS } from '@/lib/flags';
import { getThemeRegistry } from '@/lib/theme-registry';
import { vaultDisplayName } from '@/lib/vault-paths';

export const dynamic = 'force-dynamic';

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

  const { themes, defaultTheme } = await getThemeRegistry();
  return (
    <AppShell
      initialTree={initialTree}
      initialDocId={docId}
      flags={FLAGS}
      themes={themes}
      defaultTheme={defaultTheme.id}
      vaultName={vaultDisplayName()}
    />
  );
}
