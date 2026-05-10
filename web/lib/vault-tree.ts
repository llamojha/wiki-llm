import matter from 'gray-matter';

import { getObject, listObjects } from '@/lib/s3';

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
  // Hide raw/ at any level, index.md and log.md at any level
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

function buildTree(keys: string[], names: Map<string, string>): TreeNode[] {
  const root: TreeNode[] = [];
  for (const key of keys) {
    const parts = key.split('/');
    const name = names.get(key) ?? keyToName(key);
    insert(root, parts, key, name);
  }
  return root;
}

export async function getTree(): Promise<TreeNode[]> {
  let listedKeys: string[] = [];
  const names = new Map<string, string>();
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
    // index.md not found — fall back to S3 listing
  }

  if (!indexAvailable) {
    const allKeys = (await listObjects()).filter((k) => !shouldSkip(k));
    return buildTree(allKeys, names);
  }

  const allKeys = (await listObjects()).filter((k) => !shouldSkip(k));
  const listedSet = new Set(listedKeys);
  const unlisted = allKeys.filter((k) => !listedSet.has(k));

  const tree = buildTree(listedKeys, names);

  if (unlisted.length > 0) {
    tree.push({
      type: 'folder',
      id: 'folder:__unlisted',
      name: 'Unlisted',
      children: buildTree(unlisted, names),
    });
  }

  return tree;
}
