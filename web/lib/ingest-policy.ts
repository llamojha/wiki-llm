import { getStructure, type VaultStructure } from '@/lib/vault-structure';
import { RAW_PREFIX, generatedPrefix } from '@/lib/vault-paths';

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

export async function getIngestPolicy(): Promise<IngestPolicy | null> {
  const structure = await getStructure();
  const space = findIngestSpace(structure);
  if (!space) return null;
  return { space, rawPrefix: RAW_PREFIX, generatedPrefix: generatedPrefix(space) };
}
