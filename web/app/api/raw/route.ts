import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { getObject, listObjects } from '@/lib/s3';
import { getIngestPolicy, isIngestError, resolvePendingSource } from '@/lib/ingest-policy';
import { type Scope } from '@/lib/scope';
import { resolveScopeOr400 } from '@/lib/http-scope';
import { resolvePending, type ProcessedManifest } from '@/lib/curate-pending';
import { ensureVaultMode, vaultMode } from '@/lib/vault-mode';
import { isDocumentKey } from '@/lib/vault-paths';

const SPACE_RE = /^[a-z0-9][a-z0-9-]*$/;

async function getManifest(
  systemKey: (name: string) => string,
  scopeName: Scope,
): Promise<ProcessedManifest> {
  try {
    const raw = await getObject(systemKey('processed.json'));
    return JSON.parse(raw);
  } catch {
    if (scopeName === 'shared') {
      try {
        const raw = await getObject('_processed.json');
        return JSON.parse(raw);
      } catch { /* fall through */ }
    }
    return { files: {} };
  }
}

export async function GET(req: Request) {
  const gate = await requireSession(req);
  if (gate) return gate;

  const { searchParams } = new URL(req.url);
  const space = searchParams.get('space');

  // Folders mode (plan 026): "pending" is the set of recognized documents in a
  // caller-chosen source folder that have not been curated yet. There is no
  // structure.json space; a destination is not needed to count pending inputs.
  await ensureVaultMode();
  if (vaultMode() === 'folders' || vaultMode() === 'managed') {
    const resolved = resolvePendingSource(searchParams.get('source'));
    if (isIngestError(resolved)) {
      return NextResponse.json({ source: null, count: 0, keys: [], total: 0, detail: resolved.error });
    }
    const { source, sourcePrefix } = resolved;
    const scope = resolveScopeOr400({ scope: 'shared' });
    if (scope instanceof NextResponse) return scope;
    const manifest = await getManifest(scope.systemKey, 'shared');
    const keys = (await listObjects(sourcePrefix)).filter(isDocumentKey);
    const pending = await resolvePending(keys, manifest);
    let lastProcessedAt: string | null = null;
    for (const entry of Object.values(manifest.files)) {
      if (!entry.processedAt) continue;
      if (!lastProcessedAt || entry.processedAt > lastProcessedAt) lastProcessedAt = entry.processedAt;
    }
    return NextResponse.json({
      source,
      count: pending.length,
      keys: pending,
      total: keys.length,
      lastProcessedAt,
    });
  }

  const scopeName = (searchParams.get('scope') as Scope | null) ?? 'shared';
  const userId = searchParams.get('userId') ?? undefined;

  if (!space) {
    return NextResponse.json({ detail: 'space query param required' }, { status: 400 });
  }

  const scope = resolveScopeOr400({ scope: scopeName, userId });
  if (scope instanceof NextResponse) return scope;
  const policy = await getIngestPolicy(scope);
  if (!policy) {
    return NextResponse.json({ space, count: 0, keys: [], total: 0, detail: 'structure.json does not declare a generated wiki space' });
  }

  if (space !== policy.space) {
    return NextResponse.json({ space, count: 0, keys: [], total: 0, ingestSpace: policy.space });
  }

  if (!SPACE_RE.test(space)) {
    return NextResponse.json({ detail: 'invalid space name' }, { status: 400 });
  }

  const manifest = await getManifest(scope.systemKey, scope.scope);
  const keys = await listObjects(policy.rawPrefix);
  // Hash-aware pending detection — must agree with /api/curate/start so the
  // UI's "Pending: N" badge doesn't lie about re-uploaded files (it gates
  // the Process batch button via disabled={count === 0}).
  const pending = await resolvePending(keys, manifest);

  // Most-recent processedAt for the queried space, used by the sidebar's
  // "Last curated <relative>" badge. Null when nothing has been processed yet.
  let lastProcessedAt: string | null = null;
  for (const entry of Object.values(manifest.files)) {
    if (entry.space !== policy.space) continue;
    if (!entry.processedAt) continue;
    if (!lastProcessedAt || entry.processedAt > lastProcessedAt) {
      lastProcessedAt = entry.processedAt;
    }
  }

  return NextResponse.json({
    space: policy.space,
    count: pending.length,
    keys: pending,
    total: keys.length,
    scope: scope.scope,
    userId: scope.userId,
    lastProcessedAt,
  });
}
