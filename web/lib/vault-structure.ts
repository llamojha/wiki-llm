import { getObject, putObject } from '@/lib/s3';
import {
  DEFAULT_USER_ID,
  DEFAULT_USER_ROOT,
  AUTHORED_ROOT,
  GENERATED_ROOT,
  RAW_PREFIX,
  SYSTEM_ROOT,
  systemKey,
} from '@/lib/vault-paths';

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
  /** Whether AI curation may write generated pages into this space */
  generated?: boolean;
  /** Whether user-authored shared pages may exist in this space */
  authored?: boolean;
};

export type UserEntry = {
  /** Stable user id used in S3 paths under users/<id>/ */
  id: string;
  /** Display label for the user-owned personal wiki */
  label: string;
  /** Whether this user is the local single-user default */
  default?: boolean;
  /** Full S3 prefix for personal documents */
  prefix: string;
  /** Root containing this user's raw/generated/authored/system folders */
  root?: string;
  roots?: {
    raw: string;
    generated: string;
    authored: string;
    system: string;
  };
  /**
   * Spaces declared in this user's own subtree, independent of the shared
   * `spaces` list. The reserved `personal` space is implicit and never stored
   * here. Absent on structures written before v3 — treated as empty (the user
   * scope starts with no declared spaces beyond personal).
   */
  spaces?: SpaceEntry[];
};

export type VaultStructure = {
  version: 1 | 2 | 3;
  roots?: {
    raw: string;
    generated: string;
    authored: string;
    users: string;
    system: string;
  };
  defaultUser?: string;
  users?: UserEntry[];
  spaces: SpaceEntry[];
};

const STRUCTURE_KEY = systemKey('structure.json');

const DEFAULT_STRUCTURE: VaultStructure = {
  version: 3,
  roots: {
    raw: RAW_PREFIX,
    generated: `${GENERATED_ROOT}/`,
    authored: `${AUTHORED_ROOT}/`,
    users: 'users/',
    system: `${SYSTEM_ROOT}/`,
  },
  defaultUser: DEFAULT_USER_ID,
  users: [
    {
      id: DEFAULT_USER_ID,
      label: DEFAULT_USER_ID,
      default: true,
      prefix: `${DEFAULT_USER_ROOT}/`,
      root: `${DEFAULT_USER_ROOT}/`,
      roots: {
        raw: `${DEFAULT_USER_ROOT}/raw/`,
        generated: `${DEFAULT_USER_ROOT}/generated/`,
        authored: `${DEFAULT_USER_ROOT}/authored/`,
        system: `${DEFAULT_USER_ROOT}/_system/`,
      },
      spaces: [],
    },
  ],
  spaces: [],
};

/** Read structure.json from S3. Returns default if not found. */
export async function getStructure(): Promise<VaultStructure> {
  try {
    const raw = await getObject(STRUCTURE_KEY);
    return JSON.parse(raw) as VaultStructure;
  } catch {
    try {
      const raw = await getObject('structure.json');
      return JSON.parse(raw) as VaultStructure;
    } catch {
      return DEFAULT_STRUCTURE;
    }
  }
}

/** Write structure.json to S3. */
export async function putStructure(structure: VaultStructure): Promise<void> {
  await putObject(STRUCTURE_KEY, JSON.stringify(structure, null, 2));
}

/**
 * Declared spaces for a scope. Shared scope reads the top-level `spaces` list;
 * user scope reads that user's own `spaces` (independent of shared). Returns a
 * non-mutating view — empty when nothing is declared. The reserved `personal`
 * space is implicit and never appears here.
 */
export function spacesForScope(
  structure: VaultStructure,
  scope: 'shared' | 'user',
  userId?: string,
): SpaceEntry[] {
  if (scope === 'shared') return structure.spaces;
  const id = userId ?? structure.defaultUser ?? DEFAULT_USER_ID;
  return structure.users?.find((u) => u.id === id)?.spaces ?? [];
}

/**
 * Locate the mutable spaces array for a scope inside `structure`, creating the
 * user entry / array as needed. Mutating the returned array and then calling
 * `putStructure(structure)` persists the change. Use this for writes;
 * `spacesForScope` for reads.
 */
export function mutableSpacesForScope(
  structure: VaultStructure,
  scope: 'shared' | 'user',
  userId?: string,
): SpaceEntry[] {
  if (scope === 'shared') return structure.spaces;
  const id = userId ?? structure.defaultUser ?? DEFAULT_USER_ID;
  let user = structure.users?.find((u) => u.id === id);
  if (!user) {
    user = { id, label: id, prefix: `users/${id}/`, spaces: [] };
    structure.users = [...(structure.users ?? []), user];
  }
  if (!user.spaces) user.spaces = [];
  return user.spaces;
}

/**
 * Ensure a space is declared in the given scope's structure. Adds it if
 * missing. Defaults to the shared scope to preserve existing call sites.
 */
export async function ensureSpaceInStructure(
  space: string,
  scope: 'shared' | 'user' = 'shared',
  userId?: string,
): Promise<void> {
  const structure = await getStructure();
  const arr = mutableSpacesForScope(structure, scope, userId);
  if (arr.some((s) => s.name === space)) return;
  const label = space.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  arr.push({ name: space, label, indexed: true });
  await putStructure(structure);
}
