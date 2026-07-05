/**
 * Pure helpers for walking the client-side nested folder tree returned by
 * GET /api/folders. Extracted from `upload-modal.tsx` so the Library tabs and
 * their tests can share them without mounting the modal.
 *
 * Note: server-side folder logic (`web/lib/folders.ts`) uses a different node
 * shape — these two `FolderNode`s are intentionally separate.
 */

/** A node in the nested folder tree returned by GET /api/folders. */
export type FolderNode = {
  name: string;
  path: string;
  indexed: number;
  children: FolderNode[];
};

/** A single path segment: lowercase alphanumeric with hyphens. */
export const SEG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** True when every `/`-separated segment of `p` is a valid folder segment. */
export function validPath(p: string): boolean {
  return p.length > 0 && p.split('/').every((s) => SEG_RE.test(s));
}

/** Find a node by path segments within a folder tree. */
export function findFolder(list: FolderNode[], segs: string[]): FolderNode | null {
  let level = list;
  let node: FolderNode | null = null;
  for (const seg of segs) {
    node = level.find((n) => n.name === seg) ?? null;
    if (!node) return null;
    level = node.children;
  }
  return node;
}

/** Paths of every descendant folder, relative to `node` (e.g. `a`, `a/b`). */
export function descendantPaths(node: FolderNode, prefix = ''): string[] {
  let out: string[] = [];
  for (const c of node.children) {
    const p = prefix ? `${prefix}/${c.name}` : c.name;
    out.push(p);
    out = out.concat(descendantPaths(c, p));
  }
  return out;
}

/** True if a folder already has a child of the given name at `parentSegs`. */
export function childExists(list: FolderNode[], parentSegs: string[], name: string): boolean {
  const siblings = parentSegs.length === 0 ? list : findFolder(list, parentSegs)?.children ?? [];
  return siblings.some((n) => n.name === name);
}

/** Total folder count across the whole tree. */
export function countFolders(list: FolderNode[]): number {
  return list.reduce((a, n) => a + 1 + countFolders(n.children), 0);
}
