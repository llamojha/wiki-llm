import matter from 'gray-matter';

import { getObject, getObjectWithETag, listObjects, putObject } from '@/lib/s3';
import { isDocumentKey } from '@/lib/vault-paths';
import { ensureVaultMode } from '@/lib/vault-mode';
import {
  isRealPageId,
  ManagedPageError,
  parseManagedPage,
  type ManagedPage,
} from '@/lib/managed-pages';
import { wouldCreateCycle } from '@/lib/managed-tree';

/**
 * Re-parent a managed page (plan 027, specs/managed-mode.md §6/§8).
 *
 * The whole operation is a **single-file metadata edit**: it rewrites only the
 * target page's frontmatter `parent_id` and writes it back to the *same* S3 key
 * under an ETag compare-and-swap. There is deliberately **no `copyObject` /
 * `deleteObject`** — the object never moves, so `assets/<id>/` and inbound
 * `parent_id` references stay intact. This is the core value of managed mode
 * versus folders/provenance, where the same move re-keys the object.
 *
 * Validation before the write:
 * - the key must be a recognized managed document;
 * - `newParentId` (when non-null) must be a real (`pg_…`) id of an existing
 *   page in the *same* space;
 * - the edit must not introduce a cycle.
 *
 * Throws `ManagedPageError` (with an HTTP status) on any validation failure;
 * lets `ConcurrencyError` from the CAS write propagate to the caller.
 */
export async function reparentManagedPage(
  key: string,
  newParentId: string | null,
): Promise<{ key: string; parentId: string | null }> {
  await ensureVaultMode();
  if (!isDocumentKey(key)) {
    throw new ManagedPageError(`Not a managed page: ${key}`, 400);
  }

  // Read the target with its ETag for the compare-and-swap write.
  let content: string;
  let etag: string;
  try {
    ({ content, etag } = await getObjectWithETag(key));
  } catch {
    throw new ManagedPageError(`Page not found: ${key}`, 404);
  }
  const self = parseManagedPage(key, content);

  if (newParentId) {
    if (!isRealPageId(newParentId)) {
      throw new ManagedPageError('parentId must be a real page id (pg_…) or null', 400);
    }
    // Load the vault to resolve the parent + run the cycle guard. O(N) reads,
    // same cost as a tree build — acceptable for the single-user MVP.
    const keys = (await listObjects()).filter(isDocumentKey);
    const parsed = await Promise.all(
      keys.map(async (k) => {
        try {
          return parseManagedPage(k, await getObject(k));
        } catch {
          return null;
        }
      }),
    );
    const pages = parsed.filter((p): p is ManagedPage => p !== null);
    const parent = pages.find((p) => p.id === newParentId);
    if (!parent) {
      throw new ManagedPageError(`Parent page not found: ${newParentId}`, 404);
    }
    if (parent.space !== self.space) {
      throw new ManagedPageError('Parent must be in the same space', 400);
    }
    if (wouldCreateCycle(pages, self.id, newParentId)) {
      throw new ManagedPageError('Re-parent would create a cycle', 409);
    }
  }

  // Rewrite ONLY parent_id (+ updated). Same key — no object move.
  // Clone the parsed frontmatter before mutating: gray-matter caches parsed
  // results by input string and returns a shared `data` object, so mutating it
  // in place would corrupt the cache for any identical content parsed later.
  const parsed = matter(content);
  const fm = { ...parsed.data };
  if (newParentId) fm.parent_id = newParentId;
  else delete fm.parent_id;
  fm.updated = new Date().toISOString();
  const assembled = matter.stringify(parsed.content, fm);

  await putObject(key, assembled, etag);
  return { key, parentId: newParentId };
}
