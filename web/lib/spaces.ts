import { deleteObject, getObject, putObject } from '@/lib/s3';
import { movePrefix, prefixHasObjects, purgePrefix } from '@/lib/vault-ops';
import { regenerateMasterIndex, regenerateSpaceIndex } from '@/lib/index-gen';
import { appendLog } from '@/lib/log-append';
import { invalidateSearchIndex } from '@/lib/search';
import { resolveScope, type Scope } from '@/lib/scope';
import { PERSONAL_SPACE, PROVENANCE_ROOTS } from '@/lib/vault-paths';
import {
  getStructure,
  mutableSpacesForScope,
  spacesForScope,
  updateStructure,
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
export const RESERVED_NAMES = new Set<string>([
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

  const entry: SpaceEntry = {
    name,
    label: labelFor(name),
    indexed: true,
    generated: true,
    authored: true,
  };

  // Existence check + push run inside the CAS callback so the declaration is
  // written against a fresh read. Throwing SpaceError from the callback aborts
  // the retry loop (updateStructure only retries ConcurrencyError).
  await updateStructure((structure) => {
    const arr = mutableSpacesForScope(structure, scope, userId);
    if (arr.some((s) => s.name === name)) {
      throw new SpaceError(`Space "${name}" already exists`, 409);
    }
    arr.push(entry);
    return true;
  });

  const sp = resolveScope({ scope, userId });
  await appendLog('created', `${sp.authoredPrefix(name)}`, `Space: ${name}`, sp);
  invalidateSearchIndex();
  return entry;
}

/**
 * Rename a space within a single scope. Claims the new name in the scope's
 * declaration first (under optimistic concurrency), then re-keys every
 * document under that scope's `generated/<from>/` and `authored/<from>/` to
 * the new prefix, moves the per-space index file, and regenerates the scope's
 * indexes. Other scopes are untouched. If the object move fails after the
 * name is claimed, the declaration is rolled back to `from` so the space
 * isn't left pointing at a name with no data.
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

  // Preliminary validation read — fail fast before any S3 mutation so a
  // nonexistent source (404) or a name collision (409) never re-keys objects
  // into an existing space's prefix. The authoritative claim below re-checks
  // both conditions under CAS against a fresh read.
  const preview = mutableSpacesForScope(await getStructure(), scope, userId);
  if (!preview.some((s) => s.name === from)) {
    throw new SpaceError(`Space "${from}" not found`, 404);
  }
  if (preview.some((s) => s.name === to)) {
    throw new SpaceError(`Space "${to}" already exists`, 409);
  }

  const sp = resolveScope({ scope, userId });
  const moveMarker = sp.systemKey(`moves/${from}__${to}.json`);

  // Is this a resume of a previously-interrupted `from`→`to` move? `movePrefix`
  // is two-phase (copy ALL, then delete ALL sources): if it fails between the
  // phases, copies are left under `to` while the declaration is rolled back. A
  // marker written before the move (below) records that intent, so a retry
  // treats those leftovers as ours rather than a foreign collision. The marker
  // key encodes both names, so a rename from a DIFFERENT source onto the same
  // `to` won't match it and still gets the 409 preflight below.
  let resuming = false;
  try {
    await getObject(moveMarker);
    resuming = true;
  } catch {
    // no marker — a fresh move
  }

  // Content-collision preflight (fresh moves only). The declaration checks above
  // catch a *declared* `to`; this also refuses a `to` whose prefixes already
  // hold orphaned objects not tied to a declaration — without it a top-level
  // rename could silently merge into a non-empty target. Skipped on a resume so
  // an interrupted move can finish. (Deliberate behavior change; see plan 015.)
  if (
    !resuming &&
    ((await prefixHasObjects(sp.generatedPrefix(to))) ||
      (await prefixHasObjects(sp.authoredPrefix(to))))
  ) {
    throw new SpaceError(`Space "${to}" already has content`, 409);
  }

  // Claim `to` by flipping the declaration *before* moving any object. This
  // must happen first: if the declaration flip happened after the move (the
  // old order), a concurrent createSpace/renameSpace targeting the same `to`
  // could land its own declaration in the window between our move and our
  // flip, and our post-move collision check would then throw 409 after we'd
  // already copied/deleted the source objects — leaving `from`'s declaration
  // in place while its data sits under `to`'s prefix. Claiming first makes
  // the declaration change (not the object move) the atomic point that
  // decides the race: whichever renamer's CAS write lands first wins the
  // name, and the loser fails fast with no objects touched.
  //
  // Re-locate `from` by name on each attempt — a stale array index is invalid
  // after a CAS retry re-reads the structure.
  let entry!: SpaceEntry;
  await updateStructure((structure) => {
    const arr = mutableSpacesForScope(structure, scope, userId);
    const idx = arr.findIndex((s) => s.name === from);
    if (idx === -1) {
      throw new SpaceError(`Space "${from}" not found`, 404);
    }
    if (arr.some((s) => s.name === to)) {
      throw new SpaceError(`Space "${to}" already exists`, 409);
    }
    entry = { ...arr[idx], name: to, label: labelFor(to) };
    arr[idx] = entry;
    return true;
  });

  // Record move intent BEFORE touching objects, so an interrupted move (crash
  // or a transient S3 error between the copy and delete phases) is resumable —
  // a retry finds this marker, skips the content preflight above, and lets the
  // idempotent `movePrefix` finish. Best-effort: if the marker write itself
  // fails we still proceed (no worse than before this guard existed).
  await putObject(
    moveMarker,
    JSON.stringify({ from, to, scope: sp.scope, userId: sp.userId, startedAt: new Date().toISOString() }),
  ).catch(() => {});

  // Declaration now says `to`, but no objects have moved yet. If anything below
  // throws, roll the declaration back to `from` (and LEAVE the marker so the
  // next attempt resumes) so the space isn't left claimed-but-empty under `to`
  // while its data still sits under `from`.
  try {
    for (const prefixFor of [sp.generatedPrefix, sp.authoredPrefix]) {
      await movePrefix(prefixFor(from), prefixFor(to));
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
  } catch (err) {
    await updateStructure((structure) => {
      const arr = mutableSpacesForScope(structure, scope, userId);
      const idx = arr.findIndex((s) => s.name === to);
      if (idx === -1) return false;
      arr[idx] = { ...arr[idx], name: from, label: labelFor(from) };
      return true;
    });
    throw err;
  }

  // Move completed — clear the intent marker. (Harmless if it lingers: `to` is
  // now declared, so a later rename onto it 409s at the declaration check
  // before the preflight is reached.)
  await deleteObject(moveMarker).catch(() => {});

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

  // Preliminary validation read — 404 before any deletion, preserving today's
  // fast-fail. The authoritative splice runs under CAS below.
  const preview = mutableSpacesForScope(await getStructure(), scope, userId);
  if (!preview.some((s) => s.name === name)) {
    throw new SpaceError(`Space "${name}" not found`, 404);
  }

  const sp = resolveScope({ scope, userId });
  for (const prefixFor of [sp.generatedPrefix, sp.authoredPrefix]) {
    await purgePrefix(prefixFor(name));
  }
  try {
    await deleteObject(sp.systemKey(`indexes/${name}.md`));
  } catch {
    // No index for this space in this scope — nothing to delete.
  }

  // Objects deleted above; drop the declaration under optimistic concurrency
  // with a fresh findIndex per attempt. A concurrent delete that already
  // removed the entry is a no-op (nothing left to write).
  await updateStructure((structure) => {
    const arr = mutableSpacesForScope(structure, scope, userId);
    const idx = arr.findIndex((s) => s.name === name);
    if (idx === -1) return false;
    arr.splice(idx, 1);
    return true;
  });

  await regenerateMasterIndex(sp);
  await appendLog('deleted', `${sp.authoredPrefix(name)}`, `Deleted space ${name}`, sp);
  invalidateSearchIndex();
}
