import { getObject, putObject } from '@/lib/s3';

/**
 * Vault structure schema.
 *
 * Defines the user-controlled tree layout. Reindex may only add/remove
 * file entries within declared spaces — it cannot create, rename, or
 * reorganize spaces or move files between them.
 *
 * Stored as `structure.json` at the vault root in S3.
 */

export type SpaceEntry = {
  /** S3 prefix name (e.g. "articles", "wiki", "vaultmark") */
  name: string;
  /** Display label in the sidebar */
  label: string;
  /** Whether reindex should scan this space for files */
  indexed: boolean;
};

export type VaultStructure = {
  version: 1;
  spaces: SpaceEntry[];
};

const STRUCTURE_KEY = 'structure.json';

const DEFAULT_STRUCTURE: VaultStructure = {
  version: 1,
  spaces: [],
};

/** Read structure.json from S3. Returns default if not found. */
export async function getStructure(): Promise<VaultStructure> {
  try {
    const raw = await getObject(STRUCTURE_KEY);
    return JSON.parse(raw) as VaultStructure;
  } catch {
    return DEFAULT_STRUCTURE;
  }
}

/** Write structure.json to S3. */
export async function putStructure(structure: VaultStructure): Promise<void> {
  await putObject(STRUCTURE_KEY, JSON.stringify(structure, null, 2));
}
