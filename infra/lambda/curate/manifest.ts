import { createHash } from 'node:crypto';
import type { ProcessedFileEntry, ProcessedManifest } from './types.js';
import {
  getObjectOrNull,
  getObjectWithETagOrNull,
  ManifestConflictError,
  putJson,
} from './s3.js';
import type { ScopePaths } from './scope.js';

export { ManifestConflictError };

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

/**
 * Read the manifest together with its S3 ETag for compare-and-swap writes.
 * `etag` is `null` when no CAS is possible: the primary manifest is absent, or
 * only the legacy `_processed.json` exists (the first CAS write then lands the
 * primary key unconditionally, migrating the legacy manifest forward).
 */
export async function getManifestWithETag(
  bucket: string,
  prefix: string,
  scope: ScopePaths,
): Promise<{ manifest: ProcessedManifest; etag: string | null }> {
  const primary = await getObjectWithETagOrNull(bucket, prefix, manifestKey(scope));
  if (primary) {
    return { manifest: JSON.parse(primary.content) as ProcessedManifest, etag: primary.etag };
  }
  if (scope.scope === 'shared') {
    const legacy = await getObjectOrNull(bucket, prefix, '_processed.json');
    if (legacy) return { manifest: JSON.parse(legacy) as ProcessedManifest, etag: null };
  }
  return { manifest: { files: {} }, etag: null };
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

/** Build a single manifest entry (timestamped now). */
export function manifestEntry(
  hash: string,
  space: string,
  pages: string[],
  sourceCard?: string,
): ProcessedFileEntry {
  return {
    processedAt: new Date().toISOString(),
    hash,
    space,
    pages,
    ...(sourceCard ? { sourceCard } : {}),
  };
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
      [rawKey]: manifestEntry(hash, space, pages, sourceCard),
    },
  };
}

const MAX_MANIFEST_CAS_ATTEMPTS = 5;

export type ManifestReader = () => Promise<{ manifest: ProcessedManifest; etag: string | null }>;
export type ManifestWriter = (manifest: ProcessedManifest, ifMatch?: string) => Promise<void>;

/**
 * Compare-and-swap engine for a single manifest entry. Re-reads on conflict so
 * a concurrent invocation's entries merge instead of last-writer-wins.
 * Injectable read/write make the retry logic unit-testable without S3.
 */
export async function mergeWithRetry(
  read: ManifestReader,
  write: ManifestWriter,
  rawKey: string,
  entry: ProcessedFileEntry,
  maxAttempts = MAX_MANIFEST_CAS_ATTEMPTS,
): Promise<void> {
  let lastConflict: ManifestConflictError | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { manifest, etag } = await read();
    const merged: ProcessedManifest = {
      files: { ...manifest.files, [rawKey]: entry },
    };
    try {
      await write(merged, etag ?? undefined);
      return;
    } catch (err) {
      if (err instanceof ManifestConflictError) {
        lastConflict = err;
        continue;
      }
      throw err;
    }
  }
  throw lastConflict ?? new ManifestConflictError();
}

/**
 * Merge one entry into the scope's manifest with compare-and-swap + retry.
 * The cross-invocation-safe replacement for get→addToManifest→saveManifest.
 */
export async function mergeIntoManifest(
  bucket: string,
  prefix: string,
  scope: ScopePaths,
  rawKey: string,
  entry: ProcessedFileEntry,
): Promise<void> {
  await mergeWithRetry(
    () => getManifestWithETag(bucket, prefix, scope),
    (manifest, ifMatch) => putJson(bucket, prefix, manifestKey(scope), manifest, ifMatch),
    rawKey,
    entry,
  );
}
