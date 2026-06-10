import { createHash } from 'node:crypto';

import { getObject } from '@/lib/s3';

export type ProcessedFileEntry = {
  hash: string;
  /** ISO timestamp set by the Lambda when this file was curated. */
  processedAt?: string;
  /** Space the file was routed into (e.g. "wiki"). */
  space?: string;
  /** Generated page paths produced by this entry. */
  pages?: string[];
};

export type ProcessedManifest = { files: Record<string, ProcessedFileEntry> };

export function computeHash(content: string): string {
  return 'sha256:' + createHash('sha256').update(content).digest('hex');
}

/**
 * Resolve which raw keys are pending curation. A key is pending if:
 *   - it has no entry in the manifest yet (new file), or
 *   - it has an entry but the current content hash differs (re-uploaded).
 *
 * Key-only detection misses the re-upload case because the manifest still
 * carries the old hash for the same key. Hash-checking only the
 * previously-seen keys keeps the cost proportional to the manifest size,
 * not the new-file count.
 *
 * Read failures are treated as "include it" — the start route / Lambda will
 * surface a clearer error than silently skipping a file that may have been
 * deleted between the listObjects and getObject.
 */
export async function resolvePending(
  allKeys: string[],
  manifest: ProcessedManifest,
): Promise<string[]> {
  const newKeys: string[] = [];
  const possiblyStale: string[] = [];
  for (const k of allKeys) {
    if (manifest.files[k]) possiblyStale.push(k);
    else newKeys.push(k);
  }

  const modified: string[] = [];
  await Promise.all(
    possiblyStale.map(async (k) => {
      try {
        const content = await getObject(k);
        if (computeHash(content) !== manifest.files[k].hash) {
          modified.push(k);
        }
      } catch {
        modified.push(k);
      }
    }),
  );

  return [...newKeys, ...modified].sort();
}
