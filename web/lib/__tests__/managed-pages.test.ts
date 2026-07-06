import { describe, expect, it } from 'vitest';

import {
  assertSegment,
  fallbackIdForKey,
  generatePageId,
  isRealPageId,
  managedPageKey,
  ManagedPageError,
  parseManagedPage,
  slugForKey,
  spacePathForKey,
  stringifyManagedPage,
} from '@/lib/managed-pages';

describe('managed-pages', () => {
  describe('generatePageId', () => {
    it('produces pg_-prefixed ids recognized as real', () => {
      const id = generatePageId(0, () => 'abc123');
      expect(id).toBe('pg_000000000abc123');
      expect(isRealPageId(id)).toBe(true);
    });

    it('is roughly time-ordered (base36 timestamp prefix)', () => {
      const early = generatePageId(1000, () => 'aaaaaa');
      const late = generatePageId(2_000_000_000_000, () => 'aaaaaa');
      expect(early < late).toBe(true);
    });
  });

  describe('fallbackIdForKey', () => {
    it('is deterministic for the same key', () => {
      expect(fallbackIdForKey('notes/a.md')).toBe(fallbackIdForKey('notes/a.md'));
    });

    it('differs for different keys and is marked derived (pgk_)', () => {
      const a = fallbackIdForKey('notes/a.md');
      const b = fallbackIdForKey('notes/b.md');
      expect(a).not.toBe(b);
      expect(a.startsWith('pgk_')).toBe(true);
      expect(isRealPageId(a)).toBe(false);
    });
  });

  describe('spacePathForKey', () => {
    it('strips the pages/ store prefix', () => {
      expect(spacePathForKey('pages/wiki/lambda.md')).toEqual({ space: 'wiki', rest: [] });
      expect(spacePathForKey('pages/wiki/platform/x.md')).toEqual({
        space: 'wiki',
        rest: ['platform'],
      });
    });

    it('treats out-of-band top-level folder as the space', () => {
      expect(spacePathForKey('notes/deep/a.md')).toEqual({ space: 'notes', rest: ['deep'] });
    });

    it('returns empty space for a root-level doc', () => {
      expect(spacePathForKey('root.md')).toEqual({ space: '', rest: [] });
    });
  });

  describe('slugForKey', () => {
    it('is the filename stem', () => {
      expect(slugForKey('pages/wiki/lambda-curate-pipeline.md')).toBe('lambda-curate-pipeline');
    });
  });

  describe('parseManagedPage', () => {
    it('parses a fully-tracked page and preserves its real id', () => {
      const raw = [
        '---',
        'id: pg_01jaaa',
        'title: Lambda Curate Pipeline',
        'space: wiki',
        'slug: lambda-curate-pipeline',
        'parent_id: pg_01jplat',
        'status: published',
        'origin: generated',
        'labels: [aws, lambda]',
        '---',
        'body',
      ].join('\n');
      const page = parseManagedPage('pages/wiki/lambda-curate-pipeline.md', raw);
      expect(page.id).toBe('pg_01jaaa');
      expect(page.adopted).toBe(false);
      expect(page.title).toBe('Lambda Curate Pipeline');
      expect(page.space).toBe('wiki');
      expect(page.parentId).toBe('pg_01jplat');
      expect(page.status).toBe('published');
      expect(page.origin).toBe('generated');
      expect(page.labels).toEqual(['aws', 'lambda']);
    });

    it('adopts a frontmatter-less file: fallback id, path-derived space/slug/title', () => {
      const page = parseManagedPage('notes/random-note.md', '# Random Note\n\ntext');
      expect(page.adopted).toBe(true);
      expect(page.id).toBe(fallbackIdForKey('notes/random-note.md'));
      expect(page.space).toBe('notes');
      expect(page.slug).toBe('random-note');
      expect(page.title).toBe('Random Note');
      expect(page.parentId).toBeNull();
      expect(page.status).toBe('published');
      expect(page.origin).toBe('authored');
    });

    it('treats a non-real id in frontmatter as un-tracked (adopted)', () => {
      const raw = '---\nid: not-a-real-id\ntitle: X\n---\nbody';
      const page = parseManagedPage('pages/wiki/x.md', raw);
      expect(page.adopted).toBe(true);
      expect(page.id).toBe(fallbackIdForKey('pages/wiki/x.md'));
    });

    it('reads origin via the shared vocabulary (source_type fallback)', () => {
      const raw = '---\nid: pg_1\nsource_type: generated\n---\nb';
      expect(parseManagedPage('pages/w/a.md', raw).origin).toBe('generated');
    });
  });

  describe('stringifyManagedPage + round-trip', () => {
    it('round-trips through parseManagedPage preserving the id', () => {
      const md = stringifyManagedPage(
        {
          id: 'pg_01jaaa',
          title: 'Lambda',
          space: 'wiki',
          slug: 'lambda',
          parentId: 'pg_01jplat',
          origin: 'generated',
          labels: ['aws'],
        },
        'body text',
      );
      const page = parseManagedPage('pages/wiki/lambda.md', md);
      expect(page.id).toBe('pg_01jaaa');
      expect(page.parentId).toBe('pg_01jplat');
      expect(page.origin).toBe('generated');
      expect(page.labels).toEqual(['aws']);
      expect(page.adopted).toBe(false);
    });

    it('omits parent_id when null (top-level / path fallback)', () => {
      const md = stringifyManagedPage(
        { id: 'pg_1', title: 'Root', space: 'wiki', slug: 'root', parentId: null },
        'b',
      );
      expect(md).not.toContain('parent_id');
      expect(parseManagedPage('pages/wiki/root.md', md).parentId).toBeNull();
    });

    it('applies status/origin defaults', () => {
      const md = stringifyManagedPage({ id: 'pg_1', title: 'X', space: 'w', slug: 'x' }, 'b');
      const page = parseManagedPage('pages/w/x.md', md);
      expect(page.status).toBe('published');
      expect(page.origin).toBe('authored');
    });
  });

  describe('assertSegment / managedPageKey', () => {
    it('rejects invalid slug/space segments', () => {
      expect(() => assertSegment('slug', 'Bad Slug')).toThrow(ManagedPageError);
      expect(() => assertSegment('space', '')).toThrow(ManagedPageError);
      expect(() => assertSegment('slug', '../evil')).toThrow(ManagedPageError);
    });

    it('accepts valid segments and builds the canonical key', () => {
      expect(() => assertSegment('slug', 'lambda-curate')).not.toThrow();
      expect(managedPageKey('wiki', 'lambda')).toBe('pages/wiki/lambda.md');
    });
  });
});
