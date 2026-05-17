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

export async function getGeneratedSpace(bucket: string, prefix: string): Promise<string> {
  const raw = await getObjectOrNull(bucket, prefix, systemKey('structure.json'))
    ?? await getObjectOrNull(bucket, prefix, '_system/structure.json')
    ?? await getObjectOrNull(bucket, prefix, 'structure.json');
  if (!raw) return DEFAULT_INGEST_SPACE;

  const structure = JSON.parse(raw) as VaultStructure;
  const explicit = structure.spaces.find((space) => space.generated === true);
  if (explicit) return explicit.name;

  const wiki = structure.spaces.find((space) => space.name === DEFAULT_INGEST_SPACE);
  if (wiki?.generated === false) {
    throw new Error('structure.json marks wiki as not allowing generated curation output');
  }
  if (wiki) return wiki.name;

  throw new Error('structure.json does not declare a generated wiki space');
}
