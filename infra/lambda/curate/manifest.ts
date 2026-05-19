import { createHash } from 'node:crypto';
import type { ProcessedManifest } from './types.js';
import { getObjectOrNull, putJson } from './s3.js';
import type { ScopePaths } from './scope.js';

/**
 * Manifest of files that have been curated, keyed by raw S3 key.
 *
 * Per-scope: each scope (shared or a specific user) has its own
 * `_system/processed.json`. The two manifests never reference each other.
 */
function manifestKey(scope: ScopePaths): string {
  return scope.systemKey('processed.json');
}

export function computeHash(content: string): string {
  return 'sha256:' + createHash('sha256').update(content).digest('hex');
}

export async function getManifest(
  bucket: string,
  prefix: string,
  scope: ScopePaths,
): Promise<ProcessedManifest> {
  const primary = await getObjectOrNull(bucket, prefix, manifestKey(scope));
  if (primary) return JSON.parse(primary) as ProcessedManifest;

  // Legacy fallback: pre-scope shared deployments wrote to `_processed.json`
  // at the bucket root. Only honor it on shared scope to avoid leaking shared
  // manifest data into a user's view.
  if (scope.scope === 'shared') {
    const legacy = await getObjectOrNull(bucket, prefix, '_processed.json');
    if (legacy) return JSON.parse(legacy) as ProcessedManifest;
  }

  return { files: {} };
}

export async function saveManifest(
  bucket: string,
  prefix: string,
  scope: ScopePaths,
  manifest: ProcessedManifest,
): Promise<void> {
  await putJson(bucket, prefix, manifestKey(scope), manifest);
}

export function getPendingFiles(
  rawKeys: string[],
  rawContents: Map<string, string>,
  manifest: ProcessedManifest,
): string[] {
  return rawKeys.filter(key => {
    const entry = manifest.files[key];
    if (!entry) return true;
    const content = rawContents.get(key);
    if (!content) return true;
    return computeHash(content) !== entry.hash;
  });
}

export function addToManifest(
  manifest: ProcessedManifest,
  rawKey: string,
  hash: string,
  space: string,
  pages: string[],
  sourceCard?: string,
): ProcessedManifest {
  return {
    files: {
      ...manifest.files,
      [rawKey]: {
        processedAt: new Date().toISOString(),
        hash,
        space,
        pages,
        ...(sourceCard ? { sourceCard } : {}),
      },
    },
  };
}
