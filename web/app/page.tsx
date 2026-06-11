import { AppShell } from '@/components/app-shell';
import { type ApiTreeNode } from '@/lib/api';
import { getTree } from '@/lib/vault-tree';
import { FLAGS } from '@/lib/flags';
import { getThemeRegistry } from '@/lib/theme-registry';
import { vaultDisplayName } from '@/lib/vault-paths';

// Render per-request, never prerender. The tree comes from S3 and the flags
// from the runtime environment — a build-time snapshot would bake in whatever
// the build host saw (an empty tree under the Docker/CI placeholder bucket,
// stale content otherwise).
export const dynamic = 'force-dynamic';

export default async function Home() {
  let initialTree: ApiTreeNode[] = [];
  try {
    initialTree = await getTree();
  } catch {
    // S3 not reachable — AppShell renders with empty tree
  }
  const { themes, defaultTheme } = getThemeRegistry();
  return (
    <AppShell
      initialTree={initialTree}
      flags={FLAGS}
      themes={themes}
      defaultTheme={defaultTheme.id}
      vaultName={vaultDisplayName()}
    />
  );
}
