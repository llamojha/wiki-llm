import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetWith } from '@/lib/s3-mock';
import { __resetVaultMode } from '@/lib/vault-mode';
import { getTree } from '@/lib/vault-tree';

/**
 * Managed-mode tree (plan 027): recognizes the same keys as folders mode but
 * reads each document's frontmatter and assembles the tree from `parent_id`
 * (path fallback when absent). `VAULT_MODE` is set explicitly so the case does
 * not depend on the sniff marker.
 */
describe('getTree (managed mode)', () => {
  beforeEach(() => {
    __resetWith({});
    __resetVaultMode();
    process.env.VAULT_MODE = 'managed';
  });

  afterEach(() => {
    delete process.env.VAULT_MODE;
    __resetVaultMode();
  });

  it('nests a tracked page under its parent_id (openable parent with children)', async () => {
    __resetWith({
      'pages/wiki/platform.md': '---\nid: pg_plat\ntitle: Platform\nspace: wiki\n---\nbody',
      'pages/wiki/lambda.md':
        '---\nid: pg_lambda\ntitle: Lambda\nspace: wiki\nparent_id: pg_plat\n---\nbody',
      '_system/managed.json': '{"version":1}',
    });

    const tree = await getTree();
    const wiki = tree.find((n) => n.name === 'Wiki')!;
    expect(wiki.type).toBe('folder');
    const platform = wiki.children!.find((n) => n.name === 'Platform')!;
    expect(platform.type).toBe('doc');
    expect(platform.id).toBe('pages/wiki/platform.md');
    expect(platform.children).toEqual([
      { type: 'doc', id: 'pages/wiki/lambda.md', name: 'Lambda' },
    ]);
  });

  it('adopts a frontmatter-less synced file via path fallback', async () => {
    __resetWith({
      'notes/deep/synced.md': '# Synced note\n\njust text',
      '_system/managed.json': '{"version":1}',
    });

    const tree = await getTree();
    const notes = tree.find((n) => n.name === 'Notes')!;
    const deep = notes.children!.find((n) => n.name === 'Deep')!;
    expect(deep.children![0]).toEqual({
      type: 'doc',
      id: 'notes/deep/synced.md',
      name: 'Synced',
    });
  });

  it('excludes raw/ scratch and _system/ from the tree', async () => {
    __resetWith({
      'pages/wiki/a.md': '---\nid: pg_a\ntitle: A\nspace: wiki\n---\nb',
      'raw/src/x.md': '# scratch',
      '_system/managed.json': '{"version":1}',
    });

    const tree = await getTree();
    const flat = JSON.stringify(tree);
    expect(flat).toContain('pages/wiki/a.md');
    expect(flat).not.toContain('raw/src/x.md');
  });
});
