import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetVaultMode, __setVaultMode } from '@/lib/vault-mode';
import {
  displayPathForKey,
  isDocumentKey,
  isKeyInSpace,
  sourceTypeFromKey,
} from '@/lib/vault-paths';

/**
 * Managed-mode recognition (plan 027, specs/managed-mode.md §5). Managed
 * recognizes the *same* keys as folders mode — any `.md`/`.html` outside
 * `_system/`/`raw/`, minus `.keep` — because it differs only in how the tree is
 * assembled (frontmatter `parent_id`), not in what counts as a document.
 * Provenance/folders behavior is pinned in their own suites.
 */
describe('managed mode', () => {
  beforeEach(() => __setVaultMode('managed'));
  afterEach(() => __resetVaultMode());

  describe('isDocumentKey', () => {
    it('accepts pages/<space>/<slug>.md and plain out-of-band files alike', () => {
      for (const key of ['pages/wiki/lambda.md', 'notes/bar.md', 'root.md', 'page.html']) {
        expect(isDocumentKey(key)).toBe(true);
      }
    });

    it('accepts AI-generated pages (provenance is a frontmatter badge, not a hide reason)', () => {
      // A curated page lives as ordinary .md under pages/ with origin:generated
      // in frontmatter — it must appear in the tree, badged, not be hidden.
      expect(isDocumentKey('pages/wiki/ai-page.md')).toBe(true);
    });

    it('excludes _system/ and .keep markers', () => {
      expect(isDocumentKey('_system/index.md')).toBe(false);
      expect(isDocumentKey('_system/managed.json')).toBe(false);
      expect(isDocumentKey('pages/wiki/.keep')).toBe(false);
    });

    it('excludes raw pipeline inputs (scratch, not browsable)', () => {
      expect(isDocumentKey('raw/a.md')).toBe(false);
      expect(isDocumentKey('raw/sub/b.html')).toBe(false);
      expect(isDocumentKey('users/default/raw/c.md')).toBe(false);
    });

    it('rejects non-document extensions', () => {
      expect(isDocumentKey('pages/wiki/a.txt')).toBe(false);
      expect(isDocumentKey('assets/pg_01JAAA/diagram.png')).toBe(false);
    });
  });

  describe('sourceTypeFromKey', () => {
    it('always falls back to authored (frontmatter origin wins at read time)', () => {
      expect(sourceTypeFromKey('pages/wiki/a.md')).toBe('authored');
      expect(sourceTypeFromKey('generated/wiki/a.md')).toBe('authored');
    });
  });

  describe('displayPathForKey', () => {
    it('uses the key as the display path with no root stripping', () => {
      expect(displayPathForKey('pages/wiki/lambda.md')).toBe('pages / wiki / lambda');
      expect(displayPathForKey('root.md')).toBe('root');
    });
  });

  describe('isKeyInSpace', () => {
    it('matches canonical pages/<space>/… keys by their space', () => {
      // The tree offers `wiki`; the portal stores `pages/wiki/…`. Matching the
      // raw key would exclude every page the portal itself created.
      expect(isKeyInSpace('pages/wiki/lambda.md', 'wiki')).toBe(true);
      expect(isKeyInSpace('pages/wiki/platform/deep.md', 'wiki')).toBe(true);
      expect(isKeyInSpace('pages/notes/a.md', 'wiki')).toBe(false);
    });

    it('matches out-of-band files that skipped the pages/ root', () => {
      expect(isKeyInSpace('wiki/adopted.md', 'wiki')).toBe(true);
    });

    it('does not treat the store root itself as a space', () => {
      expect(isKeyInSpace('pages/wiki/a.md', 'pages')).toBe(false);
    });
  });
});
