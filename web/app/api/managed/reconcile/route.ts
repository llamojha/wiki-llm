import { NextResponse } from 'next/server';

import { invalidateSearchIndex } from '@/lib/search';
import { __resetVaultMode } from '@/lib/vault-mode';
import { reconcileManagedVault } from '@/lib/managed-reconcile';
import { flagGuard } from '@/lib/flags';
import { requireSession } from '@/lib/auth-guard';

/**
 * Reconcile / backfill the vault into fully-tracked managed pages (plan 027):
 * adopt out-of-band files and migrate a provenance vault into `pages/`. This is
 * a bulk maintenance + migration operation, so it is gated behind the same
 * `reindex` feature flag as the other rebuild surfaces and requires a session.
 *
 * Body: `{ dryRun?: boolean }` — defaults to `true` (report only, no writes).
 * A non-dry run writes the `_system/managed.json` marker, so the vault
 * subsequently sniffs as managed; the mode cache + search index are cleared.
 */
export async function POST(req: Request) {
  const gate = await requireSession(req);
  if (gate) return gate;

  const blocked = flagGuard('reindex');
  if (blocked) return blocked;

  let dryRun = true;
  try {
    const body = (await req.json()) as { dryRun?: boolean };
    if (typeof body?.dryRun === 'boolean') dryRun = body.dryRun;
  } catch {
    // no/invalid body — keep the safe default (dry run)
  }

  const report = await reconcileManagedVault({ dryRun });

  if (!dryRun) {
    // The marker just flipped the resolved mode; force a re-sniff and rebuild.
    __resetVaultMode();
    invalidateSearchIndex();
  }

  return NextResponse.json(report);
}
