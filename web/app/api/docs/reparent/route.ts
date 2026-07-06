import { NextResponse } from 'next/server';

import { regenerateIndexesForKey } from '@/lib/index-gen';
import { appendLog } from '@/lib/log-append';
import { ConcurrencyError } from '@/lib/s3';
import { upsertSearchEntry } from '@/lib/search';
import { displayPathForKey } from '@/lib/vault-paths';
import { ensureVaultMode, vaultMode } from '@/lib/vault-mode';
import { ManagedPageError } from '@/lib/managed-pages';
import { reparentManagedPage } from '@/lib/managed-reparent';
import { flagGuard } from '@/lib/flags';
import { requireSession } from '@/lib/auth-guard';

/**
 * Re-parent a managed page — a metadata-only edit (plan 027). Rewrites the
 * target page's frontmatter `parent_id` in place; the S3 object never moves.
 * Managed mode only; editor-gated like the rest of the write surface.
 *
 * Body: `{ id: string (S3 key), parentId: string | null }`.
 */
export async function POST(req: Request) {
  const gate = await requireSession(req);
  if (gate) return gate;

  const blocked = flagGuard('editor');
  if (blocked) return blocked;

  await ensureVaultMode();
  if (vaultMode() !== 'managed') {
    return NextResponse.json(
      { detail: 'Re-parenting is only available in managed vault mode' },
      { status: 400 },
    );
  }

  const { id, parentId } = (await req.json()) as { id?: string; parentId?: string | null };
  if (!id) {
    return NextResponse.json({ detail: 'id is required' }, { status: 400 });
  }
  const newParentId = typeof parentId === 'string' && parentId ? parentId : null;

  let result: { key: string; parentId: string | null };
  try {
    result = await reparentManagedPage(id, newParentId);
  } catch (err) {
    if (err instanceof ManagedPageError) {
      return NextResponse.json({ detail: err.message }, { status: err.status });
    }
    if (err instanceof ConcurrencyError) {
      return NextResponse.json(
        { detail: 'Conflict: page was modified. Reload and retry.' },
        { status: 409 },
      );
    }
    throw err;
  }

  await regenerateIndexesForKey(result.key);
  await appendLog('edited', result.key, `Re-parented to ${newParentId ?? 'root'}`);
  await upsertSearchEntry(result.key);

  return NextResponse.json({ id: result.key, path: displayPathForKey(result.key), parentId: result.parentId });
}
