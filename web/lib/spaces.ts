import { deleteObject, getObject, listObjects, putObject } from '@/lib/s3';
import { regenerateMasterIndex, regenerateSpaceIndex } from '@/lib/index-gen';
import { appendLog } from '@/lib/log-append';
import { invalidateSearchIndex } from '@/lib/search';
import { resolveScope, type ScopePaths } from '@/lib/scope';
import { DEFAULT_USER_ID, PERSONAL_SPACE, PROVENANCE_ROOTS } from '@/lib/vault-paths';
import {
  getStructure,
  putStructure,
  type SpaceEntry,
  type UserEntry,
} from '@/lib/vault-structure';

/**
 * Space (folder) administration.
 *
 * A "space" is a declared top-level folder in the vault — e.g. `wiki`,
 * `articles`. It is partitioned across provenance roots (`generated/<space>/`,
 * `authored/<space>/`) and across scopes (shared at the root, plus one subtree
 * per user under `users/<id>/...`). The canonical list of spaces lives in
 * `structure.json` (see `vault-structure.ts`); these helpers keep that
 * declaration and the underlying S3 content in sync.
 *
 * Operations are vault-global: renaming or deleting a space re-keys/removes its
 * content in *every* scope (shared + each declared user), so the structure
 * declaration never drifts from what's stored. The personal space is reserved
 * and cannot be renamed or deleted.
 */

/** Lowercase alphanumeric with hyphens; must start with a letter or digit. */
export const SPACE_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Names that may not be used for a space because they collide with provenance
 * roots, sentinel folder ids, or system files.
 */
const RESERVED_NAMES = new Set<string>([
  PERSONAL_SPACE,
  '__all',
  '__user',
  'index',
  'log',
]);

/** Carries an HTTP status so the route handler can map it to a response. */
export class SpaceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SpaceError';
  }
}

function labelFor(name: string): string {
  return name.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalize(raw: string): string {
  return raw.trim().toLowerCase();
}

function validateName(name: string): void {
  if (!name) {
    throw new SpaceError('Space name is required', 400);
  }
  if (!SPACE_NAME_RE.test(name)) {
    throw new SpaceError(
      'Space name must be lowercase alphanumeric with hyphens, starting with a letter or digit',
      400,
    );
  }
  if (RESERVED_NAMES.has(name) || PROVENANCE_ROOTS.has(name)) {
    throw new SpaceError(`"${name}" is a reserved name`, 400);
  }
}

/**
 * Every scope that holds space-partitioned content: the shared root plus one
 * subtree per declared user (falling back to the default user when none are
 * declared). Folder operations fan out across all of these.
 */
function allScopes(users: UserEntry[] | undefined): ScopePaths[] {
  const ids = users?.length ? users.map((u) => u.id) : [DEFAULT_USER_ID];
  return [
    resolveScope({ scope: 'shared' }),
    ...ids.map((id) => resolveScope({ scope: 'user', userId: id })),
  ];
}

/** List declared spaces, excluding the reserved personal space. */
export async function listSpaces(): Promise<SpaceEntry[]> {
  const structure = await getStructure();
  return structure.spaces.filter((s) => s.name !== PERSONAL_SPACE);
}

/**
 * Declare a new space. The space starts empty: the shared sidebar surfaces it
 * straight from `structure.json`, and user-scoped views show it once content is
 * uploaded into it. No S3 objects are written for an empty space (S3 has no
 * real directories).
 */
export async function createSpace(rawName: string): Promise<SpaceEntry> {
  const name = normalize(rawName);
  validateName(name);

  const structure = await getStructure();
  if (structure.spaces.some((s) => s.name === name)) {
    throw new SpaceError(`Space "${name}" already exists`, 409);
  }

  const entry: SpaceEntry = {
    name,
    label: labelFor(name),
    indexed: true,
    generated: true,
    authored: true,
  };
  structure.spaces.push(entry);
  await putStructure(structure);

  await appendLog(
    'created',
    `authored/${name}/`,
    `Space: ${name}`,
    resolveScope({ scope: 'shared' }),
  );
  invalidateSearchIndex();
  return entry;
}

/**
 * Rename a space. Re-keys every document under `generated/<from>/` and
 * `authored/<from>/` (and their per-user equivalents) to the new prefix, moves
 * the per-space index file, updates `structure.json`, and regenerates indexes
 * for every affected scope.
 */
export async function renameSpace(rawFrom: string, rawTo: string): Promise<SpaceEntry> {
  const from = normalize(rawFrom);
  const to = normalize(rawTo);
  validateName(to);

  if (from === PERSONAL_SPACE) {
    throw new SpaceError('The personal space cannot be renamed', 400);
  }
  if (from === to) {
    throw new SpaceError('New name is the same as the current name', 400);
  }

  const structure = await getStructure();
  const idx = structure.spaces.findIndex((s) => s.name === from);
  if (idx === -1) {
    throw new SpaceError(`Space "${from}" not found`, 404);
  }
  if (structure.spaces.some((s) => s.name === to)) {
    throw new SpaceError(`Space "${to}" already exists`, 409);
  }

  const scopes = allScopes(structure.users);
  for (const scope of scopes) {
    for (const prefixFor of [scope.generatedPrefix, scope.authoredPrefix]) {
      const fromPrefix = prefixFor(from);
      const toPrefix = prefixFor(to);
      const keys = await listObjects(fromPrefix);
      for (const key of keys) {
        const rel = key.slice(fromPrefix.length);
        const content = await getObject(key);
        await putObject(`${toPrefix}${rel}`, content);
        await deleteObject(key);
      }
    }
    // Move the per-space index file if one exists in this scope.
    const fromIndex = scope.systemKey(`indexes/${from}.md`);
    try {
      const content = await getObject(fromIndex);
      await putObject(scope.systemKey(`indexes/${to}.md`), content);
      await deleteObject(fromIndex);
    } catch {
      // No index for this space in this scope — nothing to move.
    }
  }

  const entry: SpaceEntry = { ...structure.spaces[idx], name: to, label: labelFor(to) };
  structure.spaces[idx] = entry;
  await putStructure(structure);

  for (const scope of scopes) {
    await regenerateSpaceIndex(to, scope);
    await regenerateMasterIndex(scope);
  }
  await appendLog(
    'edited',
    `authored/${to}/`,
    `Renamed space ${from} → ${to}`,
    resolveScope({ scope: 'shared' }),
  );
  invalidateSearchIndex();
  return entry;
}

/**
 * Delete a space and every document it contains, across all scopes. This is
 * destructive: documents under `generated/<name>/` and `authored/<name>/`
 * (shared and per-user) are removed from S3 along with the space's index file
 * and its `structure.json` entry.
 */
export async function deleteSpace(rawName: string): Promise<void> {
  const name = normalize(rawName);

  if (name === PERSONAL_SPACE) {
    throw new SpaceError('The personal space cannot be deleted', 400);
  }

  const structure = await getStructure();
  const idx = structure.spaces.findIndex((s) => s.name === name);
  if (idx === -1) {
    throw new SpaceError(`Space "${name}" not found`, 404);
  }

  const scopes = allScopes(structure.users);
  for (const scope of scopes) {
    for (const prefixFor of [scope.generatedPrefix, scope.authoredPrefix]) {
      const keys = await listObjects(prefixFor(name));
      for (const key of keys) await deleteObject(key);
    }
    try {
      await deleteObject(scope.systemKey(`indexes/${name}.md`));
    } catch {
      // No index for this space in this scope — nothing to delete.
    }
  }

  structure.spaces.splice(idx, 1);
  await putStructure(structure);

  for (const scope of scopes) await regenerateMasterIndex(scope);
  await appendLog(
    'deleted',
    `authored/${name}/`,
    `Deleted space ${name}`,
    resolveScope({ scope: 'shared' }),
  );
  invalidateSearchIndex();
}
