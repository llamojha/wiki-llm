import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renameSpace } from '@/lib/spaces';
import * as s3mock from '@/lib/s3-mock';
import { systemKey } from '@/lib/vault-paths';

/**
 * Plan 015 review fix: the content-collision 409 preflight must not block a
 * *resume* of a partially-completed move. `movePrefix` is two-phase (copy all,
 * then delete sources); if the delete phase fails, copies are left under the
 * target while the declaration rolls back. A move-intent marker lets the retry
 * finish instead of 409-ing on its own leftovers — while an unrelated rename
 * onto the same target (no matching marker) still 409s.
 */

const STRUCTURE_KEY = systemKey('structure.json');
const MOVE_MARKER = systemKey('moves/wiki__archive.json');
const doc = (t: string) => `---\ntitle: ${t}\n---\n${t} body`;

const structure = (...names: string[]) =>
  JSON.stringify(
    { version: 3, spaces: names.map((name) => ({ name, label: name.toUpperCase(), indexed: true })) },
    null,
    2,
  );

const spaceNames = (dump: Record<string, string>): string[] =>
  (JSON.parse(dump[STRUCTURE_KEY]) as { spaces: { name: string }[] }).spaces.map((s) => s.name);

describe('renameSpace — resumable after a partial move', () => {
  beforeEach(() => {
    s3mock.__resetWith({
      [STRUCTURE_KEY]: structure('wiki'),
      'authored/wiki/a.md': doc('A'),
      'authored/wiki/sub/b.md': doc('B'),
    });
  });

  it('a delete-phase failure leaves a marker; the retry completes (no 409)', async () => {
    // Fail the first source delete — copies to `archive` have already landed.
    const spy = vi.spyOn(s3mock, 'deleteObject').mockImplementationOnce(async () => {
      throw new Error('S3 delete failed');
    });

    await expect(renameSpace('wiki', 'archive')).rejects.toThrow();
    spy.mockRestore();

    const mid = s3mock.__dump();
    // Copies landed under archive; a move-intent marker was recorded; the
    // declaration rolled back to wiki.
    expect(Object.keys(mid).some((k) => k.startsWith('authored/archive/'))).toBe(true);
    expect(mid[MOVE_MARKER]).toBeDefined();
    expect(spaceNames(mid)).toContain('wiki');
    expect(spaceNames(mid)).not.toContain('archive');

    // Retry completes rather than 409-ing on the leftover archive content.
    await renameSpace('wiki', 'archive');

    const final = s3mock.__dump();
    expect(Object.keys(final).filter((k) => k.startsWith('authored/wiki/'))).toEqual([]);
    expect(final['authored/archive/a.md']).toBeDefined();
    expect(final['authored/archive/sub/b.md']).toBeDefined();
    expect(final[MOVE_MARKER]).toBeUndefined(); // marker cleared on success
    expect(spaceNames(final)).toContain('archive');
    expect(spaceNames(final)).not.toContain('wiki');
  });

  it('still 409s renaming onto a DIFFERENT source’s content (no matching marker)', async () => {
    s3mock.__resetWith({
      [STRUCTURE_KEY]: structure('wiki'),
      'authored/wiki/a.md': doc('A'),
      'authored/archive/orphan.md': doc('Orphan'), // foreign content, no marker
    });
    await expect(renameSpace('wiki', 'archive')).rejects.toMatchObject({ status: 409 });
  });
});
