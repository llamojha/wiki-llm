import { createHash } from 'node:crypto';
import type { ProcessedManifest, ProcessedFileEntry } from './types.js';
import { getObjectOrNull, putJson } from './s3.js';

const MANIFEST_KEY = '_processed.json';

export function computeHash(content: string): string {
  return 'sha256:' + createHash('sha256').update(content).digest('hex');
}

export async function getManifest(bucket: string, prefix: string): Promise<ProcessedManifest> {
  const raw = await getObjectOrNull(bucket, prefix, MANIFEST_KEY);
  if (!raw) return { files: {} };
  return JSON.parse(raw) as ProcessedManifest;
}

export async function saveManifest(bucket: string, prefix: string, manifest: ProcessedManifest): Promise<void> {
  await putJson(bucket, prefix, MANIFEST_KEY, manifest);
}

export function getPendingFiles(
  rawKeys: string[],
  rawContents: Map<string, string>,
  manifest: ProcessedManifest,
): string[] {
  return rawKeys.filter(key => {
    const entry = manifest.files[key];
    if (!entry) return true; // new file
    const content = rawContents.get(key);
    if (!content) return true;
    return computeHash(content) !== entry.hash; // modified
  });
}

export function addToManifest(
  manifest: ProcessedManifest,
  rawKey: string,
  hash: string,
  space: string,
  pages: string[],
): ProcessedManifest {
  return {
    files: {
      ...manifest.files,
      [rawKey]: {
        processedAt: new Date().toISOString(),
        hash,
        space,
        pages,
      },
    },
  };
}
