import { describe, expect, it } from 'vitest';

import type { ManagedPage } from '@/lib/managed-pages';
import { assembleManagedTree } from '@/lib/managed-tree';
import type { TreeNode } from '@/lib/vault-tree';

function page(over: Partial<ManagedPage> & { id: string; key: string }): ManagedPage {
  return {
    adopted: false,
    title: over.title ?? over.id,
    space: over.space ?? 'wiki',
    slug: over.slug ?? over.key.split('/').pop()!.replace(/\.md$/, ''),
    parentId: over.parentId ?? null,
    status: 'published',
    origin: 'authored',
    labels: [],
    ...over,
  };
}

function find(nodes: TreeNode[], name: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.name === name) return n;
    if (n.children) {
      const hit = find(n.children, name);
      if (hit) return hit;
    }
  }
  return undefined;
}

describe('assembleManagedTree', () => {
  it('nests a page under its parent_id (edge overrides path)', () => {
    const tree = assembleManagedTree([
      page({ id: 'pg_plat', key: 'pages/wiki/platform.md', title: 'Platform' }),
      page({
        id: 'pg_lambda',
        key: 'pages/wiki/lambda.md',
        title: 'Lambda',
        parentId: 'pg_plat',
      }),
    ]);
    const wiki = tree.find((n) => n.name === 'Wiki')!;
    expect(wiki.type).toBe('folder');
    const platform = wiki.children!.find((n) => n.name === 'Platform')!;
    expect(platform.type).toBe('doc');
    expect(platform.id).toBe('pages/wiki/platform.md');
    expect(platform.children).toHaveLength(1);
    expect(platform.children![0].name).toBe('Lambda');
    expect(platform.children![0].id).toBe('pages/wiki/lambda.md');
  });

  it('falls back to path nesting when parent_id is absent', () => {
    const tree = assembleManagedTree([
      page({ id: 'pgk_a', key: 'notes/deep/a.md', title: 'A', space: 'notes', adopted: true }),
    ]);
    const notes = tree.find((n) => n.name === 'Notes')!;
    const deep = notes.children!.find((n) => n.name === 'Deep')!;
    expect(deep.type).toBe('folder');
    expect(deep.children![0].name).toBe('A');
    expect(deep.children![0].type).toBe('doc');
  });

  it('orphans a page with a dangling parent_id at the space root (ignores path)', () => {
    const tree = assembleManagedTree([
      page({
        id: 'pg_x',
        key: 'pages/wiki/sub/x.md',
        title: 'X',
        parentId: 'pg_missing',
      }),
    ]);
    const wiki = tree.find((n) => n.name === 'Wiki')!;
    // Dangling → dropped at space root, NOT under a `sub` folder.
    expect(wiki.children!.some((n) => n.name === 'Sub')).toBe(false);
    expect(wiki.children!.some((n) => n.name === 'X' && n.type === 'doc')).toBe(true);
  });

  it('orphans a cross-space parent reference', () => {
    const tree = assembleManagedTree([
      page({ id: 'pg_p', key: 'pages/articles/p.md', title: 'P', space: 'articles' }),
      page({
        id: 'pg_c',
        key: 'pages/wiki/c.md',
        title: 'C',
        space: 'wiki',
        parentId: 'pg_p',
      }),
    ]);
    const wiki = tree.find((n) => n.name === 'Wiki')!;
    expect(find([wiki], 'C')).toBeDefined();
    // C must not have been nested under P (different space).
    const articles = tree.find((n) => n.name === 'Articles')!;
    expect(find(articles.children!, 'C')).toBeUndefined();
  });

  it('breaks a parent_id cycle without infinite-looping (both become orphans)', () => {
    const tree = assembleManagedTree([
      page({ id: 'pg_a', key: 'pages/wiki/a.md', title: 'A', parentId: 'pg_b' }),
      page({ id: 'pg_b', key: 'pages/wiki/b.md', title: 'B', parentId: 'pg_a' }),
    ]);
    const wiki = tree.find((n) => n.name === 'Wiki')!;
    // Neither should nest under the other; both survive at the space root.
    expect(find([wiki], 'A')).toBeDefined();
    expect(find([wiki], 'B')).toBeDefined();
  });

  it('handles a mixed adopted + tracked vault', () => {
    const tree = assembleManagedTree([
      page({ id: 'pg_plat', key: 'pages/wiki/platform.md', title: 'Platform' }),
      page({ id: 'pg_l', key: 'pages/wiki/lambda.md', title: 'Lambda', parentId: 'pg_plat' }),
      page({ id: 'pgk_syn', key: 'wiki/synced.md', title: 'Synced', space: 'wiki', adopted: true }),
    ]);
    const wiki = tree.find((n) => n.name === 'Wiki')!;
    expect(find([wiki], 'Lambda')).toBeDefined();
    expect(wiki.children!.some((n) => n.name === 'Synced')).toBe(true);
  });

  it('places a root-level doc (empty space) at the top level', () => {
    const tree = assembleManagedTree([
      page({ id: 'pgk_r', key: 'root.md', title: 'Root', space: '', adopted: true }),
    ]);
    expect(tree.some((n) => n.name === 'Root' && n.type === 'doc')).toBe(true);
  });
});
