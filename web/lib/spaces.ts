import { deleteObject, getObject, listObjects, putObject } from '@/lib/s3';
import { regenerateMasterIndex, regenerateSpaceIndex } from '@/lib/index-gen';
import { appendLog } from '@/lib/log-append';
import { invalidateSearchIndex } from '@/lib/search';
import { resolveScope, type Scope } from '@/lib/scope';
import { PERSONAL_SPACE, PROVENANCE_ROOTS } from '@/lib/vault-paths';
import {
  getStructure,
  mutableSpacesForScope,
  putStructure,
  spacesForScope,
  type SpaceEntry,
} from '@/lib/vault-structure';

/**
 * Space (folder) administration.
 *
 * A "space" is a declared top-level folder in the vault — e.g. `wiki`,
 * `articles`. It is partitioned across provenance roots (`generated/<space>/`,
 * `authored/<space>/`).
 *
 * Each scope owns its spaces independently: the shared library declares its
 * spaces in `structure.spaces`, and every user declares their own under
 * `users[].spaces`. An operation only ever touches the scope it targets —
 * renaming a shared folder leaves users' folders untouched and vice-versa. The
 * personal space is reserved and cannot be renamed or deleted.
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

/** List a scope's declared spaces, excluding the reserved personal space. */
export async function listSpaces(
  scope: Scope = 'shared',
  userId?: string,
): Promise<SpaceEntry[]> {
  const structure = await getStructure();
  return spacesForScope(structure, scope, userId).filter((s) => s.name !== PERSONAL_SPACE);
}

/**
 * Declare a new space in the given scope. The space starts empty — no S3
 * objects are written (S3 has no real directories); the sidebar surfaces it
 * once content lands inside it. Only the targeted scope is affected.
 */
export async function createSpace(
  rawName: string,
  scope: Scope = 'shared',
  userId?: string,
): Promise<SpaceEntry> {
  const name = normalize(rawName);
  validateName(name);

  const structure = await getStructure();
  const arr = mutableSpacesForScope(structure, scope, userId);
  if (arr.some((s) => s.name === name)) {
    throw new SpaceError(`Space "${name}" already exists`, 409);
  }

  const entry: SpaceEntry = {
    name,
    label: labelFor(name),
    indexed: true,
    generated: true,
    authored: true,
  };
  arr.push(entry);
  await putStructure(structure);

  const sp = resolveScope({ scope, userId });
  await appendLog('created', `${sp.authoredPrefix(name)}`, `Space: ${name}`, sp);
  invalidateSearchIndex();
  return entry;
}

/**
 * Rename a space within a single scope. Re-keys every document under that
 * scope's `generated/<from>/` and `authored/<from>/` to the new prefix, moves
 * the per-space index file, updates the scope's declaration, and regenerates
 * the scope's indexes. Other scopes are untouched.
 */
export async function renameSpace(
  rawFrom: string,
  rawTo: string,
  scope: Scope = 'shared',
  userId?: string,
): Promise<SpaceEntry> {
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
  const arr = mutableSpacesForScope(structure, scope, userId);
  const idx = arr.findIndex((s) => s.name === from);
  if (idx === -1) {
    throw new SpaceError(`Space "${from}" not found`, 404);
  }
  if (arr.some((s) => s.name === to)) {
    throw new SpaceError(`Space "${to}" already exists`, 409);
  }

  const sp = resolveScope({ scope, userId });
  for (const prefixFor of [sp.generatedPrefix, sp.authoredPrefix]) {
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
  const fromIndex = sp.systemKey(`indexes/${from}.md`);
  try {
    const content = await getObject(fromIndex);
    await putObject(sp.systemKey(`indexes/${to}.md`), content);
    await deleteObject(fromIndex);
  } catch {
    // No index for this space in this scope — nothing to move.
  }

  const entry: SpaceEntry = { ...arr[idx], name: to, label: labelFor(to) };
  arr[idx] = entry;
  await putStructure(structure);

  await regenerateSpaceIndex(to, sp);
  await regenerateMasterIndex(sp);
  await appendLog('edited', `${sp.authoredPrefix(to)}`, `Renamed space ${from} → ${to}`, sp);
  invalidateSearchIndex();
  return entry;
}

/**
 * Delete a space and every document it contains within a single scope. This is
 * destructive: documents under that scope's `generated/<name>/` and
 * `authored/<name>/` are removed along with the space's index file and its
 * declaration. Other scopes are untouched.
 */
export async function deleteSpace(
  rawName: string,
  scope: Scope = 'shared',
  userId?: string,
): Promise<void> {
  const name = normalize(rawName);

  if (name === PERSONAL_SPACE) {
    throw new SpaceError('The personal space cannot be deleted', 400);
  }

  const structure = await getStructure();
  const arr = mutableSpacesForScope(structure, scope, userId);
  const idx = arr.findIndex((s) => s.name === name);
  if (idx === -1) {
    throw new SpaceError(`Space "${name}" not found`, 404);
  }

  const sp = resolveScope({ scope, userId });
  for (const prefixFor of [sp.generatedPrefix, sp.authoredPrefix]) {
    const keys = await listObjects(prefixFor(name));
    for (const key of keys) await deleteObject(key);
  }
  try {
    await deleteObject(sp.systemKey(`indexes/${name}.md`));
  } catch {
    // No index for this space in this scope — nothing to delete.
  }

  arr.splice(idx, 1);
  await putStructure(structure);

  await regenerateMasterIndex(sp);
  await appendLog('deleted', `${sp.authoredPrefix(name)}`, `Deleted space ${name}`, sp);
  invalidateSearchIndex();
}
