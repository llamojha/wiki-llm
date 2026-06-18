import { getStructure, spacesForScope, type SpaceEntry } from '@/lib/vault-structure';
import type { ScopePaths } from '@/lib/scope';

export const INGEST_SPACE = 'wiki';

export type IngestPolicy = {
  space: string;
  rawPrefix: string;
  generatedPrefix: string;
};

function findIngestSpace(spaces: SpaceEntry[]): string | null {
  const explicit = spaces.find((space) => space.generated === true);
  if (explicit) return explicit.name;

  const wiki = spaces.find((space) => space.name === INGEST_SPACE);
  if (wiki?.generated === false) return null;
  if (wiki) return wiki.name;

  return null;
}

/**
 * Resolve the ingest policy for a given scope.
 *
 * Spaces are per-scope, so the candidate list is read from the scope's own
 * declaration; the raw/generated prefixes are scope-specific so curation only
 * ever reads and writes inside the active scope's subtree.
 */
export async function getIngestPolicy(scope: ScopePaths): Promise<IngestPolicy | null> {
  const structure = await getStructure();
  const space = findIngestSpace(spacesForScope(structure, scope.scope, scope.userId));
  if (!space) return null;
  return {
    space,
    rawPrefix: scope.rawPrefix,
    generatedPrefix: scope.generatedPrefix(space),
  };
}
