import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listFolderTree } from '@/lib/folders';
import { __resetWith } from '@/lib/s3-mock';
import { __resetVaultMode } from '@/lib/vault-mode';

/**
 * Folders-mode `/api/folders` tree: derived from the actual S3 key tree, not
 * `structure.json`. This is the choke point that keeps the Library modal's
 * folder list (and thus folder-direct uploads) working in a plain folder vault
 * — a provenance-only listing would return empty and break authored uploads.
 * `VAULT_MODE` is set explicitly so the case does not depend on the sniff.
 */
describe('listFolderTree (folders mode)', () => {
  beforeEach(() => {
    __resetWith({});
    __resetVaultMode();
    process.env.VAULT_MODE = 'folders';
  });

  afterEach(() => {
    delete process.env.VAULT_MODE;
    __resetVaultMode();
  });

  it('builds the folder tree from key paths, counting documents', async () => {
    __resetWith({
      'notes/a.md': '# A',
      'notes/sub/b.md': '# B',
      'projects/c.html': '<h1>C</h1>',
      'root.md': '# Root', // root-level doc — belongs to no folder
      '_system/index.md': 'catalog', // system — excluded
      'raw/pending.md': '# Pending', // raw scratch — excluded
      'notes/.keep': '', // marker — excluded
    });

    const tree = await listFolderTree();

    expect(tree).toEqual([
      {
        name: 'notes',
        path: 'notes',
        indexed: 2,
        children: [{ name: 'sub', path: 'notes/sub', indexed: 1, children: [] }],
      },
      { name: 'projects', path: 'projects', indexed: 1, children: [] },
    ]);
  });

  it('returns an empty tree when there are no foldered documents', async () => {
    __resetWith({ 'root.md': '# Root', '_system/index.md': 'catalog' });
    expect(await listFolderTree()).toEqual([]);
  });
});
