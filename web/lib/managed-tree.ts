import type { ManagedPage } from '@/lib/managed-pages';
import { spacePathForKey } from '@/lib/managed-pages';
import type { TreeNode } from '@/lib/vault-tree';

/**
 * Managed-mode tree assembly (plan 027, specs/managed-mode.md §6).
 *
 * Pure function — no S3 I/O. Given the parsed pages of a managed vault, build
 * the sidebar tree. The tree edge is resolved per page with this precedence:
 *
 *   1. `parent_id` present + resolves to another page in the same space
 *      (and introduces no cycle) → nest under that parent page. `parent_id`
 *      overrides the key path entirely.
 *   2. `parent_id` present but dangling / cross-space / cyclic → orphan at the
 *      space root.
 *   3. `parent_id` absent → path-derived fallback: nest by the key's path
 *      segments (relative to `pages/<space>/`), exactly like folders mode. A
 *      freshly-synced Obsidian vault with real folders therefore looks correct
 *      immediately.
 *
 * A page is a `doc` node (openable; `id` = its S3 key). A page that is a parent
 * of other pages carries those as `children` — the additive `doc.children`
 * field only managed mode populates, so folders/provenance trees are unchanged.
 * Path-fallback intermediate folders are `folder` nodes (`id` = `folder:<path>`),
 * matching the folders-mode id scheme.
 */

type Placement =
  | { kind: 'parent'; parentId: string }
  | { kind: 'path' }
  | { kind: 'orphan' };

/**
 * Whether setting `pageId`'s parent to `newParentId` would create a cycle
 * (i.e. `newParentId` is `pageId` itself or one of its descendants). Pure —
 * used by the re-parent action to *reject* the edit, rather than silently
 * orphaning it the way assembly does.
 */
export function wouldCreateCycle(
  pages: ReadonlyArray<{ id: string; parentId: string | null }>,
  pageId: string,
  newParentId: string | null,
): boolean {
  if (!newParentId) return false;
  if (newParentId === pageId) return true;
  const byId = new Map(pages.map((p) => [p.id, p]));
  const seen = new Set<string>();
  let cursor = byId.get(newParentId);
  while (cursor) {
    if (cursor.id === pageId) return true;
    if (seen.has(cursor.id)) break;
    seen.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return false;
}

function titleize(seg: string): string {
  return seg.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function byName(a: TreeNode, b: TreeNode): number {
  return a.name.localeCompare(b.name);
}

/**
 * Resolve a page's effective placement, guarding against dangling references,
 * cross-space parents, and cycles. A cycle is detected by walking the
 * `parent_id` chain within the same space; if it revisits a node or exceeds the
 * page count, the page is treated as an orphan (its edge is dropped, never
 * looped).
 */
function resolvePlacement(page: ManagedPage, byId: Map<string, ManagedPage>): Placement {
  if (!page.parentId) return { kind: 'path' };
  const parent = byId.get(page.parentId);
  if (!parent || parent.space !== page.space || parent.id === page.id) {
    return { kind: 'orphan' };
  }
  // Walk up to detect a cycle before committing to the parent edge.
  const seen = new Set<string>([page.id]);
  let cursor: ManagedPage | undefined = parent;
  while (cursor) {
    if (seen.has(cursor.id)) return { kind: 'orphan' };
    seen.add(cursor.id);
    if (!cursor.parentId) break;
    const next = byId.get(cursor.parentId);
    if (!next || next.space !== cursor.space) break;
    cursor = next;
  }
  return { kind: 'parent', parentId: page.parentId };
}

/** Find-or-create a folder child under `container` for a path segment. */
function ensureFolder(container: TreeNode[], idPath: string, name: string): TreeNode[] {
  const id = `folder:${idPath}`;
  let folder = container.find(
    (n): n is Extract<TreeNode, { type: 'folder' }> => n.type === 'folder' && n.id === id,
  );
  if (!folder) {
    folder = { type: 'folder', id, name: titleize(name), children: [] };
    container.push(folder);
  }
  return folder.children;
}

/**
 * Assemble the managed tree: one top-level `folder` per space (root-level docs,
 * `space === ''`, sit at the very top), pages nested by the placement rules.
 */
export function assembleManagedTree(pages: ManagedPage[]): TreeNode[] {
  const byId = new Map<string, ManagedPage>();
  for (const p of pages) byId.set(p.id, p);

  // Children collected per parent page id (parent_id edge wins over path).
  const childrenOf = new Map<string, ManagedPage[]>();
  // Pages placed by path fallback / orphaned at their space root.
  const rootish: ManagedPage[] = [];

  for (const page of pages) {
    const placement = resolvePlacement(page, byId);
    if (placement.kind === 'parent') {
      const arr = childrenOf.get(placement.parentId) ?? [];
      arr.push(page);
      childrenOf.set(placement.parentId, arr);
    } else {
      rootish.push(page);
    }
  }

  // Recursively build a page node, attaching its parent_id children.
  const buildPageNode = (page: ManagedPage): TreeNode => {
    const node: Extract<TreeNode, { type: 'doc' }> = {
      type: 'doc',
      id: page.key,
      name: page.title,
    };
    const kids = childrenOf.get(page.id);
    if (kids && kids.length) {
      node.children = kids.map(buildPageNode).sort(byName);
    }
    return node;
  };

  const roots: TreeNode[] = [];
  const spaceContainers = new Map<string, TreeNode[]>();

  const spaceRoot = (space: string): TreeNode[] => {
    if (!space) return roots; // root-level docs sit at the very top
    let container = spaceContainers.get(space);
    if (!container) {
      const folder: TreeNode = {
        type: 'folder',
        id: `folder:${space}`,
        name: titleize(space),
        children: [],
      };
      roots.push(folder);
      container = folder.children;
      spaceContainers.set(space, container);
    }
    return container;
  };

  for (const page of rootish) {
    const container = spaceRoot(page.space);
    const placement = resolvePlacement(page, byId);
    if (placement.kind === 'orphan') {
      // Dangling/cyclic parent → drop at the space root, ignore the path.
      container.push(buildPageNode(page));
      continue;
    }
    // Path fallback: descend intermediate folders relative to pages/<space>/.
    const { rest } = spacePathForKey(page.key);
    let level = container;
    let idPath = page.space;
    for (const seg of rest) {
      idPath = idPath ? `${idPath}/${seg}` : seg;
      level = ensureFolder(level, idPath, seg);
    }
    level.push(buildPageNode(page));
  }

  // Deterministic ordering everywhere.
  const sortDeep = (nodes: TreeNode[]): void => {
    nodes.sort(byName);
    for (const n of nodes) if (n.children) sortDeep(n.children);
  };
  sortDeep(roots);

  return roots;
}
