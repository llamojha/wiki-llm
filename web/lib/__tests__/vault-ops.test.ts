import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as s3mock from '@/lib/s3-mock';
import { movePrefix, prefixHasObjects, purgePrefix } from '@/lib/vault-ops';

/**
 * Plan 015: one two-phase, idempotent implementation behind every folder/space
 * move and delete. The load-bearing property is resumability — a failure after
 * the copy phase must never lose a key when the operation is retried.
 */

describe('movePrefix', () => {
  beforeEach(() => {
    s3mock.__resetWith({
      'authored/wiki/a.md': 'A',
      'authored/wiki/sub/b.md': 'B',
      'authored/wiki/sub/.keep': '', // non-.md marker must move too
    });
  });

  it('moves every object (incl. .keep markers), removes sources, returns count', async () => {
    const n = await movePrefix('authored/wiki/', 'authored/notes/');
    expect(n).toBe(3);

    const store = s3mock.__dump();
    expect(store['authored/notes/a.md']).toBe('A');
    expect(store['authored/notes/sub/b.md']).toBe('B');
    expect(store['authored/notes/sub/.keep']).toBe('');
    // Sources gone.
    expect(store['authored/wiki/a.md']).toBeUndefined();
    expect(store['authored/wiki/sub/b.md']).toBeUndefined();
    expect(store['authored/wiki/sub/.keep']).toBeUndefined();
  });

  it('overwrites existing target keys (documented merge semantics)', async () => {
    s3mock.__resetWith({
      'authored/wiki/a.md': 'NEW',
      'authored/notes/a.md': 'OLD',
    });
    await movePrefix('authored/wiki/', 'authored/notes/');
    expect(s3mock.__dump()['authored/notes/a.md']).toBe('NEW');
  });

  it('is resumable: a delete failure after the copy phase loses no key on retry', async () => {
    // Fail the first delete of phase 2 — copies have already landed by then.
    const spy = vi.spyOn(s3mock, 'deleteObject').mockImplementationOnce(async () => {
      throw new Error('S3 delete failed');
    });

    await expect(movePrefix('authored/wiki/', 'authored/notes/')).rejects.toThrow();

    // Copy phase completed: all three exist at the destination.
    const mid = s3mock.__dump();
    expect(mid['authored/notes/a.md']).toBe('A');
    expect(mid['authored/notes/sub/b.md']).toBe('B');
    expect(mid['authored/notes/sub/.keep']).toBe('');
    // At least one source survived the aborted delete phase.
    const remainingSources = Object.keys(mid).filter((k) => k.startsWith('authored/wiki/'));
    expect(remainingSources.length).toBeGreaterThan(0);

    // Retry (the one-time throw is spent) completes the move.
    spy.mockRestore();
    const n = await movePrefix('authored/wiki/', 'authored/notes/');
    expect(n).toBe(remainingSources.length);

    const final = s3mock.__dump();
    expect(Object.keys(final).filter((k) => k.startsWith('authored/wiki/'))).toEqual([]);
    expect(final['authored/notes/a.md']).toBe('A');
    expect(final['authored/notes/sub/b.md']).toBe('B');
    expect(final['authored/notes/sub/.keep']).toBe('');
  });
});

describe('purgePrefix', () => {
  it('removes every object under the prefix including non-.md, returns count', async () => {
    s3mock.__resetWith({
      'authored/x/a.md': 'A',
      'authored/x/.keep': '',
      'authored/y/keep.md': 'Y', // sibling prefix untouched
    });
    const n = await purgePrefix('authored/x/');
    expect(n).toBe(2);
    const store = s3mock.__dump();
    expect(store['authored/x/a.md']).toBeUndefined();
    expect(store['authored/x/.keep']).toBeUndefined();
    expect(store['authored/y/keep.md']).toBe('Y');
  });
});

describe('prefixHasObjects', () => {
  it('is true when objects exist and false otherwise', async () => {
    s3mock.__resetWith({ 'authored/x/a.md': 'A' });
    expect(await prefixHasObjects('authored/x/')).toBe(true);
    expect(await prefixHasObjects('authored/empty/')).toBe(false);
  });
});
