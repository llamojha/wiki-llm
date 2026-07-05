import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetWith } from '@/lib/s3-mock';
import { __resetVaultMode } from '@/lib/vault-mode';
import { getTree } from '@/lib/vault-tree';

/**
 * Folders-mode tree: the S3 key tree *is* the sidebar tree. One prefix-wide
 * listing, bucketed by path segments; `_system/` and `.keep` markers excluded;
 * no `structure.json` and no synthetic `__user` scope folder. `VAULT_MODE` is
 * set explicitly so the case does not depend on the sniff.
 */
describe('getTree (folders mode)', () => {
  beforeEach(() => {
    __resetWith({});
    __resetVaultMode();
    process.env.VAULT_MODE = 'folders';
  });

  afterEach(() => {
    delete process.env.VAULT_MODE;
    __resetVaultMode();
  });

  it('builds the tree from the key paths, excluding system + markers', async () => {
    __resetWith({
      'notes/a.md': '# A',
      'notes/sub/b.md': '# B',
      'root.md': '# Root',
      '_system/index.md': 'catalog',
      'notes/.keep': '',
    });

    const tree = await getTree();

    expect(tree).toEqual([
      {
        type: 'folder',
        id: 'folder:notes',
        name: 'Notes',
        children: [
          { type: 'doc', id: 'notes/a.md', name: 'A' },
          {
            type: 'folder',
            id: 'folder:notes/sub',
            name: 'Sub',
            children: [{ type: 'doc', id: 'notes/sub/b.md', name: 'B' }],
          },
        ],
      },
      { type: 'doc', id: 'root.md', name: 'Root' },
    ]);
  });

  it('returns an empty tree for an empty vault', async () => {
    __resetWith({});
    expect(await getTree()).toEqual([]);
  });
});
