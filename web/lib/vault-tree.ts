import { listObjects } from '@/lib/s3';
import { getStructure } from '@/lib/vault-structure';
import {
  DEFAULT_USER_ID,
  authoredPrefix,
  generatedPrefix,
  isDocumentKey,
  personalPrefix,
} from '@/lib/vault-paths';
import { resolveScope } from '@/lib/scope';

export type TreeNode =
  | { type: 'doc'; id: string; name: string }
  | { type: 'folder'; id: string; name: string; children: TreeNode[] };

function stemToTitle(stem: string): string {
  return stem
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function keyToName(key: string): string {
  const stem = key.split('/').pop()!.replace(/\.md$/, '');
  return stemToTitle(stem);
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
 * Build the full vault tree with one synthetic `__user` folder containing the
 * active user's content (all spaces, including `personal`) and one folder per
 * declared shared space.
 *
 * The sidebar's scope toggle filters this single tree: `shared` hides `__user`,
 * `user` returns only `__user`'s children.
 */
export async function getTree(): Promise<TreeNode[]> {
  const structure = await getStructure();
  const tree: TreeNode[] = [];
  const defaultUser = structure.defaultUser || DEFAULT_USER_ID;
  const userScope = resolveScope({ scope: 'user', userId: defaultUser });
  const userLabel = structure.users?.find((u) => u.id === defaultUser)?.label || 'My wiki';

  // Build the user's library: personal first, then any other declared spaces
  // they have content in (both generated and authored).
  const userChildren: TreeNode[] = [];

  const personalKeys = (await listObjects(personalPrefix(defaultUser))).filter(isDocumentKey);
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

  for (const space of structure.spaces.filter((s) => s.indexed)) {
    const generated = (await listObjects(userScope.generatedPrefix(space.name))).filter(isDocumentKey);
    const authored = (await listObjects(userScope.authoredPrefix(space.name))).filter(isDocumentKey);
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

  // Shared spaces — one folder per declared `indexed` space.
  for (const space of structure.spaces.filter((s) => s.indexed)) {
    const generated = (await listObjects(generatedPrefix(space.name))).filter(isDocumentKey);
    const authored = (await listObjects(authoredPrefix(space.name))).filter(isDocumentKey);
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
