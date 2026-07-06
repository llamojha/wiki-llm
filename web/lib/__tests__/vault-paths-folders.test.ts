import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetVaultMode, __setVaultMode } from '@/lib/vault-mode';
import { displayPathForKey, isDocumentKey, sourceTypeFromKey } from '@/lib/vault-paths';

/**
 * Folders-mode recognition: any `.md`/`.html` outside `_system/` is a document,
 * top-level `index.md`/`log.md` are ordinary docs, and there is no provenance
 * root to strip or classify. Provenance-mode behavior is pinned separately in
 * `vault-paths.test.ts` (which runs with the default provenance fallback).
 */
describe('folders mode', () => {
  beforeEach(() => __setVaultMode('folders'));
  afterEach(() => __resetVaultMode());

  describe('isDocumentKey', () => {
    it('accepts plain folders of .md and .html', () => {
      for (const key of ['notes/a.md', 'projects/deep/nested/b.md', 'root.md', 'page.html']) {
        expect(isDocumentKey(key)).toBe(true);
      }
    });

    it('treats root index.md and log.md as ordinary docs (unlike provenance)', () => {
      expect(isDocumentKey('index.md')).toBe(true);
      expect(isDocumentKey('log.md')).toBe(true);
      expect(isDocumentKey('notes/index.md')).toBe(true);
    });

    it('excludes _system/ and .keep markers', () => {
      expect(isDocumentKey('_system/index.md')).toBe(false);
      expect(isDocumentKey('_system/indexes/notes.md')).toBe(false);
      expect(isDocumentKey('notes/.keep')).toBe(false);
    });

    it('excludes raw pipeline inputs (scratch, not browsable)', () => {
      // With curate/raw opted in, un-curated uploads land under raw/ — they must
      // not leak into the sidebar/search/read route before curation.
      expect(isDocumentKey('raw/a.md')).toBe(false);
      expect(isDocumentKey('raw/sub/b.html')).toBe(false);
      expect(isDocumentKey('users/default/raw/c.md')).toBe(false);
    });

    it('rejects non-document extensions', () => {
      expect(isDocumentKey('notes/a.txt')).toBe(false);
      expect(isDocumentKey('assets/logo.png')).toBe(false);
    });

    it('does not misread a top-level folder named users/ as a scope', () => {
      // A user could legitimately have a `users/` folder of notes in folders mode.
      expect(isDocumentKey('users/alice/notes.md')).toBe(true);
    });
  });

  describe('sourceTypeFromKey', () => {
    it('always falls back to authored (frontmatter wins at read time)', () => {
      expect(sourceTypeFromKey('notes/a.md')).toBe('authored');
      expect(sourceTypeFromKey('generated/wiki/a.md')).toBe('authored');
    });
  });

  describe('displayPathForKey', () => {
    it('uses the key as the display path with no root stripping', () => {
      expect(displayPathForKey('notes/sub/day.md')).toBe('notes / sub / day');
      expect(displayPathForKey('root.md')).toBe('root');
      expect(displayPathForKey('page.html')).toBe('page');
    });
  });
});
