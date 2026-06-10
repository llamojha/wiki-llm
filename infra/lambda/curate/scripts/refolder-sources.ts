/**
 * One-shot migration: re-folder existing source pages from
 *   generated/<space>/sources/<slug>.md
 * to the deterministic layout
 *   generated/<space>/sources/<placement>/<slug>.md
 *
 * Pure S3 plumbing — no Bedrock calls. See specs/sources-foldering.md.
 *
 * Usage (from infra/lambda/curate/):
 *   npx tsx scripts/refolder-sources.ts --space wiki                  # dry-run
 *   npx tsx scripts/refolder-sources.ts --space wiki --apply          # mutate
 *   npx tsx scripts/refolder-sources.ts --space wiki --scope user --userId amllamojha --apply
 *
 * Env (fallbacks): VAULT_BUCKET, VAULT_PREFIX, VAULT_REGION / S3_REGION.
 */
import {
  getObject,
  listObjects,
  putJson,
  copyObject,
  deleteObject,
} from '../s3.js';
import { resolveScope, type ScopePaths } from '../scope.js';
import { placementFromRawKey, sourcePageKey } from '../paths.js';
import { getManifest, saveManifest } from '../manifest.js';

type Args = {
  space: string;
  scope: 'shared' | 'user';
  userId?: string;
  bucket: string;
  prefix: string;
  apply: boolean;
};

type MoveOp = {
  hash: string;
  rawKey: string;
  cardKey: string;
  oldPagePath: string;
  newPagePath: string;
};

function parseArgs(argv: string[]): Args {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }

  const space = (args.space ?? '') as string;
  if (!space) {
    throw new Error('--space is required (e.g. --space wiki)');
  }

  const scope = ((args.scope ?? 'shared') as string) as 'shared' | 'user';
  if (scope !== 'shared' && scope !== 'user') {
    throw new Error(`--scope must be 'shared' or 'user', got: ${scope}`);
  }

  const userId = args.userId as string | undefined;
  if (scope === 'user' && !userId) {
    throw new Error('--userId is required when --scope user');
  }

  const bucket = (args.bucket ?? process.env.VAULT_BUCKET ?? '') as string;
  if (!bucket) {
    throw new Error('--bucket or env VAULT_BUCKET is required');
  }

  const prefix = (args.prefix ?? process.env.VAULT_PREFIX ?? '') as string;
  const apply = args.apply === true || args.apply === 'true';

  return { space, scope, userId, bucket, prefix, apply };
}

async function detectRollups(
  bucket: string,
  prefix: string,
  scope: ScopePaths,
  space: string,
): Promise<string[]> {
  const generatedRoot = scope.generatedPrefix(space);
  const allKeys = await listObjects(bucket, prefix, generatedRoot);
  return allKeys.filter((k) => {
    if (!k.endsWith('.md')) return false;
    // sources/* is per-source pages (what we're migrating). Everything else
    // under generated/<space>/ is a synthesized rollup.
    const tail = k.slice(generatedRoot.length);
    return !tail.startsWith('sources/');
  });
}

async function planMoves(
  bucket: string,
  prefix: string,
  scope: ScopePaths,
  space: string,
): Promise<MoveOp[]> {
  const cardsPrefix = scope.systemKey('source-cards/');
  const cardKeys = await listObjects(bucket, prefix, cardsPrefix);
  const ops: MoveOp[] = [];

  for (const cardKey of cardKeys) {
    if (!cardKey.endsWith('.json')) continue;
    let raw: string;
    try {
      raw = await getObject(bucket, prefix, cardKey);
    } catch (err) {
      console.warn(`! skip ${cardKey}: read failed (${(err as Error).message})`);
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      console.warn(`! skip ${cardKey}: JSON parse failed (${(err as Error).message})`);
      continue;
    }

    const cardSpace = parsed.space as string | undefined;
    if (cardSpace !== space) continue;

    const rawKey = parsed.rawKey as string | undefined;
    const sourcePage = parsed.sourcePage as string | undefined;
    const hash = parsed.hash as string | undefined;
    if (!rawKey || !sourcePage || !hash) {
      console.warn(`! skip ${cardKey}: missing rawKey/sourcePage/hash`);
      continue;
    }

    const placement = placementFromRawKey(rawKey);
    const slug = sourcePage.split('/').pop()?.replace(/\.md$/, '') ?? '';
    if (!slug) {
      console.warn(`! skip ${cardKey}: cannot derive slug from sourcePage=${sourcePage}`);
      continue;
    }

    const newPagePath = sourcePageKey(scope.generatedPrefix(space), placement, slug);
    if (newPagePath === sourcePage) continue; // already migrated

    ops.push({ hash, rawKey, cardKey, oldPagePath: sourcePage, newPagePath });
  }

  return ops;
}

async function execMove(bucket: string, prefix: string, op: MoveOp): Promise<void> {
  // 1. Copy old → new (idempotent if the new key already exists; S3 overwrites).
  await copyObject(bucket, prefix, op.oldPagePath, op.newPagePath);
  // 2. Update card JSON to point at new path. Preserve every other field.
  const raw = await getObject(bucket, prefix, op.cardKey);
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  parsed.sourcePage = op.newPagePath;
  parsed.placement = placementFromRawKey(op.rawKey);
  await putJson(bucket, prefix, op.cardKey, parsed);
}

async function rewriteManifest(
  bucket: string,
  prefix: string,
  scope: ScopePaths,
  ops: MoveOp[],
): Promise<number> {
  const oldToNew = new Map(ops.map((op) => [op.oldPagePath, op.newPagePath]));
  const manifest = await getManifest(bucket, prefix, scope);
  let touched = 0;
  for (const entry of Object.values(manifest.files)) {
    if (!entry.pages || entry.pages.length === 0) continue;
    const next = entry.pages.map((p) => oldToNew.get(p) ?? p);
    if (next.some((p, i) => p !== entry.pages[i])) {
      entry.pages = next;
      touched++;
    }
  }
  if (touched > 0) {
    await saveManifest(bucket, prefix, scope, manifest);
  }
  return touched;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const scope = resolveScope({ scope: args.scope, userId: args.userId });
  const label = `${args.scope}${args.userId ? `:${args.userId}` : ''} / ${args.space}`;

  console.log(`▸ refolder-sources ${label} bucket=${args.bucket} prefix=${args.prefix || '(none)'} apply=${args.apply}`);

  const rollups = await detectRollups(args.bucket, args.prefix, scope, args.space);
  if (rollups.length > 0) {
    console.error(`\n✗ Refusing to run: found ${rollups.length} synthesized rollup(s) outside sources/.`);
    console.error('  Rewriting citations inside rollups is out of scope for this migration script.');
    console.error('  Either delete the rollups (they will be regenerated by synthesis) or extend this script.');
    for (const r of rollups.slice(0, 10)) console.error(`  · ${r}`);
    if (rollups.length > 10) console.error(`  · ... and ${rollups.length - 10} more`);
    process.exit(2);
  }

  const ops = await planMoves(args.bucket, args.prefix, scope, args.space);
  console.log(`\n  Planned moves: ${ops.length}`);

  if (ops.length === 0) {
    console.log('  Nothing to do — every source-card already points at its deterministic path.');
    return;
  }

  // Show a sample of the plan
  const sample = ops.slice(0, 10);
  for (const op of sample) {
    console.log(`  · ${op.oldPagePath}`);
    console.log(`      → ${op.newPagePath}`);
  }
  if (ops.length > sample.length) {
    console.log(`  · ... and ${ops.length - sample.length} more`);
  }

  if (!args.apply) {
    console.log('\n  [dry-run] Pass --apply to execute. No S3 mutations performed.');
    return;
  }

  console.log('\n  Applying moves...');
  let done = 0;
  let failed = 0;
  for (const op of ops) {
    try {
      await execMove(args.bucket, args.prefix, op);
      done++;
      if (done % 25 === 0) console.log(`    ${done}/${ops.length} copies + card updates`);
    } catch (err) {
      failed++;
      console.error(`    ✗ ${op.oldPagePath}: ${(err as Error).message}`);
    }
  }
  console.log(`    ${done}/${ops.length} copies + card updates (failed: ${failed})`);

  console.log('\n  Rewriting manifest entries...');
  const successful = ops.filter((_, i) => i < done);
  const touched = await rewriteManifest(args.bucket, args.prefix, scope, successful);
  console.log(`    ${touched} manifest entries rewritten`);

  console.log('\n  Deleting old keys...');
  let deleted = 0;
  for (const op of successful) {
    if (op.oldPagePath === op.newPagePath) continue;
    try {
      await deleteObject(args.bucket, args.prefix, op.oldPagePath);
      deleted++;
    } catch (err) {
      console.error(`    ✗ delete ${op.oldPagePath}: ${(err as Error).message}`);
    }
  }
  console.log(`    ${deleted}/${successful.length} old keys deleted`);

  console.log('\n✓ Done.');
}

main().catch((err) => {
  console.error('\n✗ Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
