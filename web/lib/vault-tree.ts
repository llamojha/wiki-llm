import matter from 'gray-matter';

import { getObject, listObjects } from '@/lib/s3';
import { getStructure } from '@/lib/vault-structure';

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

function shouldSkip(key: string): boolean {
  if (key.includes('/raw/')) return true;
  const filename = key.split('/').pop()!;
  if (filename === 'index.md' || filename === 'log.md') return true;
  if (filename.match(/^log-.*\.md$/)) return true;
  if (filename === '.keep') return true;
  return false;
}

function insert(root: TreeNode[], parts: string[], key: string, name: string): void {
  if (parts.length === 1) {
    root.push({ type: 'doc', id: key, name });
    return;
  }
  const folderName = parts[0];
  const folderId = 'folder:' + key.split('/').slice(0, key.split('/').length - parts.length + 1).join('/');

  let folder = root.find(
    (n): n is TreeNode & { type: 'folder' } => n.type === 'folder' && n.id === folderId,
  );
  if (!folder) {
    folder = { type: 'folder', id: folderId, name: stemToTitle(folderName), children: [] };
    root.push(folder);
  }
  insert(folder.children, parts.slice(1), key, name);
}

function buildTree(keys: string[], stripPrefix?: string): TreeNode[] {
  const root: TreeNode[] = [];
  for (const key of keys) {
    const rel = stripPrefix ? key.slice(stripPrefix.length + 1) : key;
    const parts = rel.split('/');
    const name = keyToName(key);
    insert(root, parts, key, name);
  }
  return root;
}

export async function getTree(): Promise<TreeNode[]> {
  const structure = await getStructure();

  // If structure.json exists with spaces, use it as the authoritative layout
  if (structure.spaces.length > 0) {
    const tree: TreeNode[] = [];

    for (const space of structure.spaces) {
      const allKeys = await listObjects(`${space.name}/`);
      const keys = allKeys.filter((k) => !shouldSkip(k));

      const children = buildTree(keys, space.name);
      tree.push({
        type: 'folder',
        id: `folder:${space.name}`,
        name: space.label,
        children,
      });
    }

    return tree;
  }

  // Fallback: no structure.json — use index.md or full S3 listing
  let listedKeys: string[] = [];
  let indexAvailable = false;

  try {
    const raw = await getObject('index.md');
    const { content } = matter(raw);
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*[-*]\s+(.+?\.md)/);
      if (m) {
        const key = m[1].trim();
        if (!shouldSkip(key)) listedKeys.push(key);
      }
    }
    indexAvailable = true;
  } catch {
    // index.md not found
  }

  if (!indexAvailable) {
    const allKeys = (await listObjects()).filter((k) => !shouldSkip(k));
    return buildTree(allKeys);
  }

  const allKeys = (await listObjects()).filter((k) => !shouldSkip(k));
  const listedSet = new Set(listedKeys);
  const unlisted = allKeys.filter((k) => !listedSet.has(k));

  const tree = buildTree(listedKeys);

  if (unlisted.length > 0) {
    tree.push({
      type: 'folder',
      id: 'folder:__unlisted',
      name: 'Unlisted',
      children: buildTree(unlisted),
    });
  }

  return tree;
}
