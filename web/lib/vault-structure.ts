import {
  ConcurrencyError,
  getObject,
  getObjectWithETag,
  ObjectAlreadyExistsError,
  putObject,
  putObjectIfAbsent,
} from '@/lib/s3';
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
  /** S3 prefix name (e.g. "articles", "wiki", "canopy") */
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

/**
 * Read structure.json with its S3 ETag for optimistic concurrency.
 *
 * `etag` is `null` when no compare-and-swap is possible: the primary key is
 * absent (a legacy `structure.json` was read, or the default is returned). In
 * that case the first write must be unconditional — see `updateStructure`.
 * The default structure is cloned so callers can mutate it without corrupting
 * the shared module constant.
 */
export async function getStructureWithETag(): Promise<{
  structure: VaultStructure;
  etag: string | null;
}> {
  try {
    const { content, etag } = await getObjectWithETag(STRUCTURE_KEY);
    return { structure: JSON.parse(content) as VaultStructure, etag };
  } catch {
    try {
      const raw = await getObject('structure.json');
      return { structure: JSON.parse(raw) as VaultStructure, etag: null };
    } catch {
      return { structure: structuredClone(DEFAULT_STRUCTURE), etag: null };
    }
  }
}

const MAX_CAS_ATTEMPTS = 3;

/**
 * Read-mutate-write structure.json with optimistic concurrency.
 *
 * `mutate` receives a fresh structure and either mutates it in place and
 * returns true (persist) or returns false (no-op, e.g. the space already
 * exists). The whole read+mutate is retried on `ConcurrencyError` up to 3
 * attempts so a concurrent writer's change is re-read and re-merged instead of
 * clobbered. Non-concurrency errors thrown from `mutate` (e.g. a
 * `SpaceError`) propagate immediately and abort the loop.
 *
 * When the structure does not exist yet (`etag === null`), the write goes
 * through `putObjectIfAbsent` (`If-None-Match: *`) instead of an unconditional
 * `putObject`. Two racing first-writes would otherwise both succeed and the
 * later one silently drops the earlier one's space declaration with no
 * `ConcurrencyError` to retry; routing the null-etag branch through the create
 * precondition forces the loser to hit `ObjectAlreadyExistsError`, which this
 * loop treats the same as `ConcurrencyError` — re-read and retry.
 */
export async function updateStructure(
  mutate: (structure: VaultStructure) => boolean | Promise<boolean>,
): Promise<VaultStructure> {
  let lastConflict: ConcurrencyError | undefined;
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const { structure, etag } = await getStructureWithETag();
    const shouldWrite = await mutate(structure);
    if (!shouldWrite) return structure;
    try {
      const body = JSON.stringify(structure, null, 2);
      if (etag == null) {
        await putObjectIfAbsent(STRUCTURE_KEY, body);
      } else {
        await putObject(STRUCTURE_KEY, body, etag);
      }
      return structure;
    } catch (err) {
      if (err instanceof ConcurrencyError || err instanceof ObjectAlreadyExistsError) {
        lastConflict = err instanceof ConcurrencyError ? err : new ConcurrencyError();
        continue;
      }
      throw err;
    }
  }
  throw lastConflict ?? new ConcurrencyError();
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
 * user entry / array as needed. Mutate the returned array from inside an
 * `updateStructure` callback to persist the change under optimistic
 * concurrency. Use this for writes; `spacesForScope` for reads.
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
  await updateStructure((structure) => {
    const arr = mutableSpacesForScope(structure, scope, userId);
    if (arr.some((s) => s.name === space)) return false;
    const label = space.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    arr.push({ name: space, label, indexed: true });
    return true;
  });
}
