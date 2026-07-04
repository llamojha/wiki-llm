import { listAllKeys, putObject } from '@/lib/s3';
import { movePrefix, prefixHasObjects, purgePrefix } from '@/lib/vault-ops';
import { regenerateMasterIndex, regenerateSpaceIndex } from '@/lib/index-gen';
import { appendLog } from '@/lib/log-append';
import { invalidateSearchIndex } from '@/lib/search';
import { resolveScope, type Scope, type ScopePaths } from '@/lib/scope';
import { PERSONAL_SPACE, PROVENANCE_ROOTS, isDocumentKey } from '@/lib/vault-paths';
import { ensureSpaceInStructure } from '@/lib/vault-structure';
import {
  RESERVED_NAMES,
  SPACE_NAME_RE,
  SpaceError,
  createSpace,
  deleteSpace,
  listSpaces,
  renameSpace,
} from '@/lib/spaces';

/**
 * Nested folder administration.
 *
 * A "folder" here is any prefix under a scope's content roots — both the
 * top-level spaces (`authored/<space>/`) declared in `structure.json` and the
 * subfolders nested beneath them (`authored/<space>/<a>/<b>/`).
 *
 * Top-level operations delegate to `lib/spaces.ts` so the structure manifest
 * stays authoritative (declare on create, re-key + reindex on rename, purge on
 * delete). Nested operations work purely on S3 prefixes: an empty nested folder
 * is materialised by a `.keep` marker so it persists with no documents in it,
 * and rename/delete re-key or remove every object under the sub-prefix across
 * both the `authored/` and `generated/` provenance roots.
 *
 * Every operation is bound to a single scope (`shared` or a user's subtree) and
 * never touches another scope. See `lib/scope.ts`.
 */

/** Marker object that keeps an otherwise-empty folder present in S3. */
const KEEP_MARKER = '.keep';

/** A node in the folder tree returned to the Library modal. */
export type FolderNode = {
  /** Leaf segment, e.g. `runbooks`. */
  name: string;
  /** Full path from the space root, e.g. `platform/runbooks`. */
  path: string;
  /** Count of indexable documents in this folder's subtree. */
  indexed: number;
  children: FolderNode[];
};

function normalizeSegment(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Validate a single nested path segment (same shape as a space name). */
function validateSegment(seg: string): void {
  if (!seg) throw new SpaceError('Folder name is required', 400);
  if (!SPACE_NAME_RE.test(seg)) {
    throw new SpaceError(
      'Folder name must be lowercase alphanumeric with hyphens, starting with a letter or digit',
      400,
    );
  }
  if (seg === KEEP_MARKER || PROVENANCE_ROOTS.has(seg)) {
    throw new SpaceError(`"${seg}" is a reserved name`, 400);
  }
}

/** Split + normalize a `a/b/c` path into validated lowercase segments. */
function toSegments(rawPath: string): string[] {
  const segs = rawPath
    .split('/')
    .map(normalizeSegment)
    .filter(Boolean);
  if (!segs.length) throw new SpaceError('Folder path is required', 400);
  for (const seg of segs) validateSegment(seg);
  // The top-level segment shares the space namespace, so it carries the same
  // reservations as a space name (e.g. `personal`, `index`, `log`). A reserved
  // word is fine deeper in the path — it's just a subfolder name there.
  if (RESERVED_NAMES.has(segs[0])) {
    throw new SpaceError(`"${segs[0]}" is a reserved name`, 400);
  }
  return segs;
}

/** Content roots (`authored/`, `generated/`) for a scope, sans trailing space. */
function contentRoots(sp: ScopePaths): string[] {
  // `authoredPrefix('x')` → `authored/x/`; strip the `x/` to get the root.
  const stripSpace = (withSpace: string) => withSpace.replace(/[^/]+\/$/, '');
  return [stripSpace(sp.authoredPrefix('x')), stripSpace(sp.generatedPrefix('x'))];
}

/**
 * Build the nested folder tree for a scope, with per-folder indexed-document
 * counts. Declared-but-empty top-level spaces are merged in from the structure
 * manifest; nested folders are discovered from S3 (including `.keep`-only empty
 * ones). The reserved `personal` space is excluded — it is surfaced elsewhere.
 */
export async function listFolderTree(
  scope: Scope = 'shared',
  userId?: string,
): Promise<FolderNode[]> {
  const sp = resolveScope({ scope, userId });

  type Build = {
    name: string;
    path: string;
    direct: number;
    children: Map<string, Build>;
  };
  const roots = new Map<string, Build>();

  const ensureNode = (segs: string[]): Build => {
    let level = roots;
    let node: Build | undefined;
    for (let i = 0; i < segs.length; i++) {
      const name = segs[i];
      node = level.get(name);
      if (!node) {
        node = { name, path: segs.slice(0, i + 1).join('/'), direct: 0, children: new Map() };
        level.set(name, node);
      }
      level = node.children;
    }
    return node!;
  };

  for (const root of contentRoots(sp)) {
    const keys = await listAllKeys(root);
    for (const key of keys) {
      const rel = key.slice(root.length); // e.g. `space/a/b/file.md`
      const parts = rel.split('/').filter(Boolean);
      if (parts.length < 1) continue;
      if (parts[0] === PERSONAL_SPACE) continue; // reserved, surfaced separately
      const folderSegs = parts.slice(0, -1); // drop filename
      if (!folderSegs.length) continue; // object sitting directly at the root
      const node = ensureNode(folderSegs);
      if (isDocumentKey(key)) node.direct += 1;
    }
  }

  // Merge declared top-level spaces so freshly-created empty ones still show.
  for (const space of await listSpaces(scope, userId)) {
    if (space.name === PERSONAL_SPACE) continue;
    ensureNode([space.name]);
  }

  // Convert to FolderNode, computing recursive indexed counts.
  const toNode = (b: Build): FolderNode => {
    const children = [...b.children.values()]
      .sort((a, c) => a.name.localeCompare(c.name))
      .map(toNode);
    const indexed = b.direct + children.reduce((sum, c) => sum + c.indexed, 0);
    return { name: b.name, path: b.path, indexed, children };
  };

  return [...roots.values()]
    .sort((a, c) => a.name.localeCompare(c.name))
    .map(toNode);
}

/**
 * Create a folder at `rawPath` within a scope.
 *
 * A single-segment path is a top-level space and is delegated to
 * `createSpace` (which declares it in `structure.json`). A nested path
 * materialises a `.keep` marker at the authored sub-prefix and ensures its
 * top-level space is declared so the sidebar walks it.
 */
export async function createFolder(
  rawPath: string,
  scope: Scope = 'shared',
  userId?: string,
): Promise<FolderNode> {
  const segs = toSegments(rawPath);

  if (segs.length === 1) {
    const entry = await createSpace(segs[0], scope, userId);
    return { name: entry.name, path: entry.name, indexed: 0, children: [] };
  }

  const sp = resolveScope({ scope, userId });
  const [space, ...rest] = segs;
  const keepKey = `${sp.authoredPrefix(space)}${rest.join('/')}/${KEEP_MARKER}`;

  // Reject if the folder already has any content (a `.keep` or documents).
  const existing = await listAllKeys(`${sp.authoredPrefix(space)}${rest.join('/')}/`);
  if (existing.length) {
    throw new SpaceError(`Folder "${rawPath}" already exists`, 409);
  }

  await ensureSpaceInStructure(space, scope, userId);
  await putObject(keepKey, '');
  await appendLog('created', keepKey, `Folder: ${segs.join('/')}`, sp);
  invalidateSearchIndex();

  return { name: segs[segs.length - 1], path: segs.join('/'), indexed: 0, children: [] };
}

/**
 * Rename a folder's leaf segment. Top-level renames delegate to `renameSpace`
 * (re-keys content + moves the index). Nested renames re-key every object —
 * documents and the `.keep` marker — under the sub-prefix across both content
 * roots, then regenerate the space's indexes.
 */
export async function renameFolder(
  rawFrom: string,
  rawTo: string,
  scope: Scope = 'shared',
  userId?: string,
): Promise<FolderNode> {
  const fromSegs = toSegments(rawFrom);
  const toLeaf = normalizeSegment(rawTo);
  validateSegment(toLeaf);

  if (fromSegs.length === 1) {
    // `renameSpace` now moves every object (documents AND `.keep` markers) via
    // vault-ops.movePrefix, so no leftover-marker sweep is needed here.
    const entry = await renameSpace(fromSegs[0], toLeaf, scope, userId);
    return { name: entry.name, path: entry.name, indexed: 0, children: [] };
  }

  const fromLeaf = fromSegs[fromSegs.length - 1];
  if (toLeaf === fromLeaf) {
    throw new SpaceError('New name is the same as the current name', 400);
  }
  const space = fromSegs[0];
  const parentRest = fromSegs.slice(1, -1);
  const toSegs = [...fromSegs.slice(0, -1), toLeaf];

  const sp = resolveScope({ scope, userId });
  const subFrom = `${[...parentRest, fromLeaf].join('/')}/`;
  const subTo = `${[...parentRest, toLeaf].join('/')}/`;

  // Preflight: both content roots must be clear at the target before moving
  // anything. Checking inline would let an authored move succeed and then a
  // generated collision throw, leaving the folder half-renamed.
  for (const prefixFor of [sp.authoredPrefix, sp.generatedPrefix]) {
    if (await prefixHasObjects(`${prefixFor(space)}${subTo}`)) {
      throw new SpaceError(`Folder "${toSegs.join('/')}" already exists`, 409);
    }
  }

  let moved = 0;
  for (const prefixFor of [sp.authoredPrefix, sp.generatedPrefix]) {
    moved += await movePrefix(`${prefixFor(space)}${subFrom}`, `${prefixFor(space)}${subTo}`);
  }
  if (!moved) {
    throw new SpaceError(`Folder "${rawFrom}" not found`, 404);
  }

  await regenerateSpaceIndex(space, sp);
  await regenerateMasterIndex(sp);
  await appendLog('edited', sp.authoredPrefix(space), `Renamed folder ${rawFrom} → ${toSegs.join('/')}`, sp);
  invalidateSearchIndex();

  return { name: toLeaf, path: toSegs.join('/'), indexed: 0, children: [] };
}

/**
 * Delete a folder and everything inside it. Top-level deletes delegate to
 * `deleteSpace`. Nested deletes remove every object under the sub-prefix across
 * both content roots, then regenerate the space's indexes.
 */
export async function deleteFolder(
  rawPath: string,
  scope: Scope = 'shared',
  userId?: string,
): Promise<void> {
  const segs = toSegments(rawPath);

  if (segs.length === 1) {
    // `deleteSpace` now purges every object (documents AND `.keep` markers) via
    // vault-ops.purgePrefix, so no marker sweep is needed here.
    await deleteSpace(segs[0], scope, userId);
    return;
  }

  const space = segs[0];
  const sub = `${segs.slice(1).join('/')}/`;
  const sp = resolveScope({ scope, userId });

  let removed = 0;
  for (const prefixFor of [sp.authoredPrefix, sp.generatedPrefix]) {
    removed += await purgePrefix(`${prefixFor(space)}${sub}`);
  }
  if (!removed) {
    throw new SpaceError(`Folder "${rawPath}" not found`, 404);
  }

  await regenerateSpaceIndex(space, sp);
  await regenerateMasterIndex(sp);
  await appendLog('deleted', sp.authoredPrefix(space), `Deleted folder ${segs.join('/')}`, sp);
  invalidateSearchIndex();
}

// Re-exported so the route can map domain errors to HTTP statuses without
// importing from two modules.
export { SpaceError };
