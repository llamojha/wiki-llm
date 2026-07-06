import { listObjects, getObject } from '@/lib/s3';
import { getStructure, spacesForScope } from '@/lib/vault-structure';
import {
  DEFAULT_USER_ID,
  authoredPrefix,
  generatedPrefix,
  isDocumentKey,
  personalPrefix,
} from '@/lib/vault-paths';
import { ensureVaultMode, vaultMode } from '@/lib/vault-mode';
import { parseManagedPage, type ManagedPage } from '@/lib/managed-pages';
import { assembleManagedTree } from '@/lib/managed-tree';
import { resolveScope } from '@/lib/scope';

export type TreeNode =
  | { type: 'doc'; id: string; name: string; children?: TreeNode[] }
  | { type: 'folder'; id: string; name: string; children: TreeNode[] };

function stemToTitle(stem: string): string {
  return stem
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function keyToName(key: string): string {
  const stem = key.split('/').pop()!.replace(/\.(md|html)$/, '');
  return stemToTitle(stem);
}

/**
 * Insert a document into the folders-mode tree, creating folder nodes for each
 * path segment. Folder ids are the cumulative path (`folder:notes/sub`) so they
 * are stable and human-readable — unlike the provenance builder, there is no
 * space/prefix indirection here: the key path *is* the tree path.
 */
function insertFolders(root: TreeNode[], segments: string[], key: string, ancestry: string): void {
  if (segments.length === 1) {
    root.push({ type: 'doc', id: key, name: keyToName(key) });
    return;
  }
  const name = segments[0];
  const path = ancestry ? `${ancestry}/${name}` : name;
  const folderId = `folder:${path}`;
  let folder = root.find(
    (n): n is TreeNode & { type: 'folder' } => n.type === 'folder' && n.id === folderId,
  );
  if (!folder) {
    folder = { type: 'folder', id: folderId, name: stemToTitle(name), children: [] };
    root.push(folder);
  }
  insertFolders(folder.children, segments.slice(1), key, path);
}

/**
 * Folders-mode tree: one prefix-wide listing of every recognized document,
 * bucketed by path segments. Top-level folders are the spaces; there is no
 * `structure.json` and no `users/` subtree (single-tenant). Keys are sorted so
 * the output is deterministic.
 */
export async function getFoldersTree(): Promise<TreeNode[]> {
  const keys = (await listObjects()).filter(isDocumentKey).sort();
  const tree: TreeNode[] = [];
  for (const key of keys) {
    insertFolders(tree, key.split('/').filter(Boolean), key, '');
  }
  return tree;
}

function insert(root: TreeNode[], folderPrefix: string, parts: string[], key: string): void {
  if (parts.length === 1) {
    root.push({ type: 'doc', id: key, name: keyToName(key) });
    return;
  }

  const folderName = parts[0];
  const folderId = `folder:${folderPrefix}/${parts.slice(0, -1).join('/')}`;
  let folder = root.find(
    (n): n is TreeNode & { type: 'folder' } => n.type === 'folder' && n.id === folderId,
  );
  if (!folder) {
    folder = { type: 'folder', id: folderId, name: stemToTitle(folderName), children: [] };
    root.push(folder);
  }
  insert(folder.children, folderPrefix, parts.slice(1), key);
}

function addKeys(root: TreeNode[], space: string, storagePrefix: string, keys: string[]): void {
  for (const key of keys) {
    const rel = key.slice(storagePrefix.length);
    const parts = rel.split('/').filter(Boolean);
    if (parts.length) insert(root, space, parts, key);
  }
}

/**
 * Managed-mode tree: recognize the same keys as folders mode, but read each
 * document's frontmatter and assemble the tree from `parent_id` (falling back
 * to the key path when absent). One read per document — the tree edge lives
 * inside the file, unlike folders mode where the key path alone suffices.
 * Assembly is delegated to the pure `assembleManagedTree` (specs/managed-mode.md
 * §6). No persistent cache in v1.
 */
export async function getManagedTree(): Promise<TreeNode[]> {
  const keys = (await listObjects()).filter(isDocumentKey);
  const parsed = await Promise.all(
    keys.map(async (key) => {
      try {
        return parseManagedPage(key, await getObject(key));
      } catch {
        return null; // skip unreadable docs
      }
    }),
  );
  const pages = parsed.filter((p): p is ManagedPage => p !== null);
  return assembleManagedTree(pages);
}

/**
 * Build the full vault tree with one synthetic `__user` folder containing the
 * active user's content (all spaces, including `personal`) and one folder per
 * declared shared space.
 *
 * The sidebar's scope toggle filters this single tree: `shared` hides `__user`,
 * `user` returns only `__user`'s children.
 */
export async function getTree(): Promise<TreeNode[]> {
  await ensureVaultMode();
  if (vaultMode() === 'managed') return getManagedTree();
  if (vaultMode() === 'folders') return getFoldersTree();

  const structure = await getStructure();
  const tree: TreeNode[] = [];
  const defaultUser = structure.defaultUser || DEFAULT_USER_ID;
  const userScope = resolveScope({ scope: 'user', userId: defaultUser });
  const userLabel = structure.users?.find((u) => u.id === defaultUser)?.label || 'My wiki';

  // Declared spaces to walk. Skip `personal` in the user list — it's covered by
  // the dedicated block below; otherwise an `indexed: true` personal entry would
  // re-walk the same `users/<id>/authored/personal/` prefix and double every doc.
  const userSpaces = spacesForScope(structure, 'user', defaultUser).filter(
    (s) => s.indexed && s.name !== 'personal',
  );
  const sharedSpaces = structure.spaces.filter((s) => s.indexed);

  // Fire every S3 LIST concurrently. Latency was previously ~2N+2 sequential
  // round-trips per tree build; now it is a single wave. Results are bucketed
  // per space and assembled in the original order below, so the output tree is
  // byte-identical. `Promise.all` rejects fast — same observable throw contract
  // as the old serial `await`s.
  const filterDocs = (keys: string[]) => keys.filter(isDocumentKey);
  const personalP = listObjects(personalPrefix(defaultUser)).then(filterDocs);
  const userSpaceP = userSpaces.map((space) => ({
    space,
    generated: listObjects(userScope.generatedPrefix(space.name)).then(filterDocs),
    authored: listObjects(userScope.authoredPrefix(space.name)).then(filterDocs),
  }));
  const sharedSpaceP = sharedSpaces.map((space) => ({
    space,
    generated: listObjects(generatedPrefix(space.name)).then(filterDocs),
    authored: listObjects(authoredPrefix(space.name)).then(filterDocs),
  }));

  await Promise.all([
    personalP,
    ...userSpaceP.flatMap((s) => [s.generated, s.authored]),
    ...sharedSpaceP.flatMap((s) => [s.generated, s.authored]),
  ]);

  // Assemble the user's library: personal first, then the user's own declared
  // spaces in declaration order (both generated and authored).
  const userChildren: TreeNode[] = [];

  const personalKeys = await personalP;
  if (personalKeys.length) {
    const personalChildren: TreeNode[] = [];
    addKeys(personalChildren, `__user/personal`, personalPrefix(defaultUser), personalKeys);
    userChildren.push({
      type: 'folder',
      id: 'folder:__user/personal',
      name: 'Personal',
      children: personalChildren,
    });
  }

  for (const { space, generated: generatedP, authored: authoredP } of userSpaceP) {
    const generated = await generatedP;
    const authored = await authoredP;
    if (!generated.length && !authored.length) continue;
    const spaceChildren: TreeNode[] = [];
    addKeys(spaceChildren, `__user/${space.name}`, userScope.generatedPrefix(space.name), generated);
    addKeys(spaceChildren, `__user/${space.name}`, userScope.authoredPrefix(space.name), authored);
    userChildren.push({
      type: 'folder',
      id: `folder:__user/${space.name}`,
      name: space.label,
      children: spaceChildren,
    });
  }

  tree.push({
    type: 'folder',
    id: 'folder:__user',
    name: userLabel,
    children: userChildren,
  });

  // Shared spaces — one folder per declared `indexed` space. Unlike user spaces,
  // shared spaces are NOT skipped when empty; preserve that asymmetry.
  for (const { space, generated: generatedP, authored: authoredP } of sharedSpaceP) {
    const generated = await generatedP;
    const authored = await authoredP;
    const children: TreeNode[] = [];
    addKeys(children, space.name, generatedPrefix(space.name), generated);
    addKeys(children, space.name, authoredPrefix(space.name), authored);
    tree.push({
      type: 'folder',
      id: `folder:${space.name}`,
      name: space.label,
      children,
    });
  }

  return tree;
}
