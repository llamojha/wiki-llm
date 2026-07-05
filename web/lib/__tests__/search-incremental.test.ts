import { beforeEach, describe, expect, it, vi } from 'vitest';

import { putObject } from '@/lib/s3';
import * as s3mock from '@/lib/s3-mock';
import {
  getAllEntries,
  invalidateSearchIndex,
  removeSearchEntry,
  search,
  upsertSearchEntry,
} from '@/lib/search';

/**
 * Plan 014: single-key writes patch the cached index incrementally instead of
 * throwing it away and re-crawling the whole vault. These tests pin the read
 * cost (exactly one document read per upsert) and the cold-cache no-op that
 * keeps the approach safe on serverless.
 */

const doc = (title: string) => `---\ntitle: ${title}\nsource_type: authored\n---\n${title} body.`;

const SEED = {
  'authored/wiki/a.md': doc('Apple'),
  'authored/wiki/b.md': doc('Banana'),
  'authored/wiki/c.md': doc('Cherry'),
};

// The s3 facade delegates reads to `mock.getObject` via its namespace import,
// so spying here counts every document read regardless of caller.
const readSpy = vi.spyOn(s3mock, 'getObject');

describe('incremental search-index maintenance', () => {
  beforeEach(() => {
    s3mock.__resetWith({ ...SEED });
    invalidateSearchIndex();
    readSpy.mockClear();
  });

  it('upsert reads exactly one document and refreshes search + home entries', async () => {
    await getAllEntries(); // warm the index (reads all three)
    readSpy.mockClear();

    await putObject('authored/wiki/a.md', doc('Apricot'));
    await upsertSearchEntry('authored/wiki/a.md');

    expect(readSpy).toHaveBeenCalledTimes(1);

    const hits = await search('Apricot');
    expect(hits.some((h) => h.id === 'authored/wiki/a.md')).toBe(true);

    const entries = await getAllEntries();
    expect(entries.find((e) => e.id === 'authored/wiki/a.md')!.title).toBe('Apricot');
    // No rebuild happened — still no further reads beyond the single upsert.
    expect(readSpy).toHaveBeenCalledTimes(1);
  });

  it('remove drops the entry from both search and the home view', async () => {
    await getAllEntries(); // warm so the cache is resolved

    removeSearchEntry('authored/wiki/b.md');

    const entries = await getAllEntries();
    expect(entries.some((e) => e.id === 'authored/wiki/b.md')).toBe(false);

    const hits = await search('Banana');
    expect(hits.some((h) => h.id === 'authored/wiki/b.md')).toBe(false);
  });

  it('upsert on a cold cache is a no-op; the next search builds fresh', async () => {
    // Cache is cold (invalidated in beforeEach, never warmed).
    await upsertSearchEntry('authored/wiki/a.md');
    expect(readSpy).toHaveBeenCalledTimes(0);

    const hits = await search('Apple');
    expect(hits.some((h) => h.id === 'authored/wiki/a.md')).toBe(true);
    // The fresh build read the whole (3-doc) vault, not zero.
    expect(readSpy.mock.calls.length).toBeGreaterThan(0);
  });
});
