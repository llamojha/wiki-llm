import { beforeEach, describe, expect, it } from 'vitest';

import { GET } from '@/app/api/docs/route';
import { __resetWith } from '@/lib/s3-mock';
import { getAllEntries, invalidateSearchIndex } from '@/lib/search';

/**
 * The home view (`GET /api/docs?view=recent|starred`) is now a projection over
 * the cached search index (plan 013) rather than a second full-vault crawl.
 * These tests pin the two things that moved: entries carry author/tags/starred,
 * and the handler's recent-desc ordering + starred filter still hold.
 */

const DOCS = {
  'authored/wiki/alpha.md':
    '---\ntitle: Alpha\nauthor: al\nupdated: 2026-01-01T00:00:00.000Z\n---\nalpha body',
  'authored/wiki/beta.md':
    '---\ntitle: Beta\nauthor: bo\ntags:\n  - x\n  - y\nupdated: 2026-03-01T00:00:00.000Z\nstarred: true\n---\nbeta body',
  'authored/wiki/gamma.md':
    '---\ntitle: Gamma\nauthor: ga\nupdated: 2026-02-01T00:00:00.000Z\n---\ngamma body',
};

async function jsonOf(view: string) {
  const res = await GET(new Request(`http://localhost/api/docs?view=${view}`));
  return res.json() as Promise<Array<Record<string, unknown>>>;
}

describe('home view from the cached index', () => {
  beforeEach(() => {
    __resetWith(DOCS);
    invalidateSearchIndex();
  });

  it('entries carry author, tags, and starred', async () => {
    const entries = await getAllEntries();
    const beta = entries.find((e) => e.id === 'authored/wiki/beta.md')!;
    expect(beta.author).toBe('bo');
    expect(beta.tags).toEqual(['x', 'y']);
    expect(beta.starred).toBe(true);

    const alpha = entries.find((e) => e.id === 'authored/wiki/alpha.md')!;
    expect(alpha.tags).toEqual([]);
    expect(alpha.starred).toBe(false);
  });

  it('recent view is sorted by updated desc', async () => {
    const docs = await jsonOf('recent');
    expect(docs.map((d) => d.id)).toEqual([
      'authored/wiki/beta.md', // 2026-03
      'authored/wiki/gamma.md', // 2026-02
      'authored/wiki/alpha.md', // 2026-01
    ]);
  });

  it('starred view returns only starred docs', async () => {
    const docs = await jsonOf('starred');
    expect(docs.map((d) => d.id)).toEqual(['authored/wiki/beta.md']);
  });
});
