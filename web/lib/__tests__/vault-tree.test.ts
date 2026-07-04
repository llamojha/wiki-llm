import { beforeEach, describe, expect, it } from 'vitest';

import { __resetWith } from '@/lib/s3-mock';
import { getTree } from '@/lib/vault-tree';
import { systemKey } from '@/lib/vault-paths';
import type { VaultStructure } from '@/lib/vault-structure';

/**
 * `getTree` fires all per-space S3 listings concurrently (plan 012) and then
 * assembles them in a fixed order: the synthetic `__user` folder first
 * (personal child first), then each declared shared space in declaration
 * order, generated docs before authored within each space. This test pins the
 * exact assembled JSON so the parallelization stays byte-identical — and it
 * guards the same tree that plans 013/014 build on.
 */

const STRUCTURE_KEY = systemKey('structure.json');

function structureWith(...names: string[]): VaultStructure {
  return {
    version: 3,
    spaces: names.map((name) => ({ name, label: name.toUpperCase(), indexed: true })),
  };
}

describe('getTree', () => {
  beforeEach(() => {
    __resetWith({});
  });

  it('assembles user + shared spaces in declaration order', async () => {
    __resetWith({
      [STRUCTURE_KEY]: JSON.stringify(structureWith('wiki', 'notes'), null, 2),
      // personal (under the default user)
      'users/default/authored/personal/hello.md': '',
      // shared: generated before authored within a space
      'generated/wiki/a.md': '',
      'authored/wiki/b.md': '',
      'generated/notes/c.md': '',
    });

    const tree = await getTree();

    expect(tree).toEqual([
      {
        type: 'folder',
        id: 'folder:__user',
        name: 'My wiki',
        children: [
          {
            type: 'folder',
            id: 'folder:__user/personal',
            name: 'Personal',
            children: [
              { type: 'doc', id: 'users/default/authored/personal/hello.md', name: 'Hello' },
            ],
          },
        ],
      },
      {
        type: 'folder',
        id: 'folder:wiki',
        name: 'WIKI',
        children: [
          { type: 'doc', id: 'generated/wiki/a.md', name: 'A' },
          { type: 'doc', id: 'authored/wiki/b.md', name: 'B' },
        ],
      },
      {
        type: 'folder',
        id: 'folder:notes',
        name: 'NOTES',
        children: [{ type: 'doc', id: 'generated/notes/c.md', name: 'C' }],
      },
    ]);
  });

  it('keeps empty shared spaces but drops empty user spaces', async () => {
    __resetWith({
      [STRUCTURE_KEY]: JSON.stringify(structureWith('empty'), null, 2),
    });

    const tree = await getTree();

    // __user has no personal/user content → empty children, still present.
    // The shared `empty` space is NOT skipped even with zero docs.
    expect(tree).toEqual([
      { type: 'folder', id: 'folder:__user', name: 'My wiki', children: [] },
      { type: 'folder', id: 'folder:empty', name: 'EMPTY', children: [] },
    ]);
  });
});
