import { getStructure, type VaultStructure } from '@/lib/vault-structure';
import type { ScopePaths } from '@/lib/scope';

export const INGEST_SPACE = 'wiki';

export type IngestPolicy = {
  space: string;
  rawPrefix: string;
  generatedPrefix: string;
};

function findIngestSpace(structure: VaultStructure): string | null {
  const explicit = structure.spaces.find((space) => space.generated === true);
  if (explicit) return explicit.name;

  const wiki = structure.spaces.find((space) => space.name === INGEST_SPACE);
  if (wiki?.generated === false) return null;
  if (wiki) return wiki.name;

  return null;
}

/**
 * Resolve the ingest policy for a given scope.
 *
 * The space list is global to the vault (read from shared `_system/structure.json`),
 * but the raw/generated prefixes are scope-specific so curation only ever reads
 * and writes inside the active scope's subtree.
 */
export async function getIngestPolicy(scope: ScopePaths): Promise<IngestPolicy | null> {
  const structure = await getStructure();
  const space = findIngestSpace(structure);
  if (!space) return null;
  return {
    space,
    rawPrefix: scope.rawPrefix,
    generatedPrefix: scope.generatedPrefix(space),
  };
}
