import { copyObject, deleteObject, listAllKeys } from '@/lib/s3';

/**
 * Bulk prefix operations shared by every folder/space move and delete.
 *
 * S3 has no atomic multi-object move, so these are two-phase and *idempotent*
 * rather than atomic: `movePrefix` copies every object to the destination
 * first, then deletes the sources. A crash between phases leaves duplicates
 * (safe — nothing is lost), never a split move; re-running completes it
 * (already-copied keys are simply recopied). This replaces seven hand-rolled
 * `list → getObject → putObject → deleteObject` loops whose per-key
 * copy-then-delete could strand content across the old and new prefixes on any
 * mid-loop failure.
 *
 * All three use `listAllKeys` (every object, not just `.md`), so `.keep`
 * markers and any other non-document objects move/purge with the documents —
 * removing the `.keep`-sweep workarounds the `.md`-only callers needed.
 *
 * Callers own all side effects (index regeneration, logging, search
 * invalidation, structure.json). This module only touches object bytes.
 *
 * Prefixes must not nest (`toPrefix` under `fromPrefix` or vice-versa) — all
 * callers move between sibling prefixes, and the trailing `/` guards against
 * substring-prefix collisions (`wiki/` never matches `wiki-new/`).
 */

/** Copy/delete concurrency — enough to hide S3 latency without flooding it. */
const BATCH = 10;

async function inBatches<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH) {
    await Promise.all(items.slice(i, i + BATCH).map(fn));
  }
}

/**
 * Move every object under `fromPrefix` to `toPrefix`. Two-phase and idempotent:
 * copy ALL objects, then delete ALL sources. Returns the number of objects moved.
 */
export async function movePrefix(fromPrefix: string, toPrefix: string): Promise<number> {
  const keys = await listAllKeys(fromPrefix);
  // Phase 1 — copy everything to the destination.
  await inBatches(keys, (key) => copyObject(key, `${toPrefix}${key.slice(fromPrefix.length)}`));
  // Phase 2 — delete the sources only after every copy has landed.
  await inBatches(keys, (key) => deleteObject(key));
  return keys.length;
}

/** Delete every object under `prefix`. Returns the count. Idempotent. */
export async function purgePrefix(prefix: string): Promise<number> {
  const keys = await listAllKeys(prefix);
  await inBatches(keys, (key) => deleteObject(key));
  return keys.length;
}

/** True when any object exists under `prefix` (collision preflight). */
export async function prefixHasObjects(prefix: string): Promise<boolean> {
  return (await listAllKeys(prefix)).length > 0;
}
