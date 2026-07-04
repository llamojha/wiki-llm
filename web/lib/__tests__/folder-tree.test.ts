import { describe, expect, it } from 'vitest';

import {
  type FolderNode,
  childExists,
  countFolders,
  descendantPaths,
  findFolder,
  validPath,
} from '@/lib/folder-tree';

/** Pure folder-tree helpers extracted from upload-modal.tsx (plan 016). */

const node = (name: string, children: FolderNode[] = []): FolderNode => ({
  name,
  path: name,
  indexed: 0,
  children,
});

const tree: FolderNode[] = [
  node('wiki', [node('runbooks', [node('db')]), node('adr')]),
  node('notes'),
];

describe('findFolder', () => {
  it('resolves a nested path', () => {
    expect(findFolder(tree, ['wiki', 'runbooks', 'db'])?.name).toBe('db');
  });
  it('returns null on a miss', () => {
    expect(findFolder(tree, ['wiki', 'nope'])).toBeNull();
  });
});

describe('descendantPaths', () => {
  it('lists every descendant relative to the node', () => {
    const wiki = findFolder(tree, ['wiki'])!;
    expect(descendantPaths(wiki)).toEqual(['runbooks', 'runbooks/db', 'adr']);
  });
});

describe('childExists', () => {
  it('detects a direct child at the top level and nested', () => {
    expect(childExists(tree, [], 'wiki')).toBe(true);
    expect(childExists(tree, ['wiki'], 'adr')).toBe(true);
    expect(childExists(tree, ['wiki'], 'missing')).toBe(false);
  });
});

describe('countFolders', () => {
  it('counts every node in the tree', () => {
    // wiki, runbooks, db, adr, notes
    expect(countFolders(tree)).toBe(5);
  });
});

describe('validPath', () => {
  it('accepts valid segments and rejects the rest', () => {
    expect(validPath('a/b-c/d1')).toBe(true);
    expect(validPath('')).toBe(false);
    expect(validPath('Bad')).toBe(false);
    expect(validPath('a//b')).toBe(false);
    expect(validPath('-lead')).toBe(false);
  });
});
