import { getObjectOrNull } from './s3.js';
import { systemKey } from './paths.js';

export const DEFAULT_INGEST_SPACE = 'wiki';

type SpaceEntry = {
  name: string;
  generated?: boolean;
};

type VaultStructure = {
  version: number;
  spaces: SpaceEntry[];
};

async function loadStructure(bucket: string, prefix: string): Promise<VaultStructure | null> {
  const raw = await getObjectOrNull(bucket, prefix, systemKey('structure.json'))
    ?? await getObjectOrNull(bucket, prefix, '_system/structure.json')
    ?? await getObjectOrNull(bucket, prefix, 'structure.json');
  if (!raw) return null;
  return JSON.parse(raw) as VaultStructure;
}

export async function getGeneratedSpace(bucket: string, prefix: string): Promise<string> {
  const structure = await loadStructure(bucket, prefix);
  if (!structure) return DEFAULT_INGEST_SPACE;

  const explicit = structure.spaces.find((space) => space.generated === true);
  if (explicit) return explicit.name;

  const wiki = structure.spaces.find((space) => space.name === DEFAULT_INGEST_SPACE);
  if (wiki?.generated === false) {
    throw new Error('structure.json marks wiki as not allowing generated curation output');
  }
  if (wiki) return wiki.name;

  throw new Error('structure.json does not declare a generated wiki space');
}

/**
 * Returns all spaces with `generated: true`, in declaration order.
 * The first entry is the default fallback (matches `getGeneratedSpace`).
 * Empty list means no structure.json — caller should treat `[DEFAULT_INGEST_SPACE]` as the fallback.
 */
export async function getGeneratedSpaces(bucket: string, prefix: string): Promise<string[]> {
  const structure = await loadStructure(bucket, prefix);
  if (!structure) return [DEFAULT_INGEST_SPACE];
  const generated = structure.spaces.filter((s) => s.generated === true).map((s) => s.name);
  return generated.length > 0 ? generated : [DEFAULT_INGEST_SPACE];
}
