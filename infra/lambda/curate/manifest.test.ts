import { describe, it, expect } from '@jest/globals';
import { computeHash, getPendingFiles, addToManifest } from './manifest.js';
import type { ProcessedManifest } from './types.js';

describe('manifest', () => {
  describe('computeHash', () => {
    it('produces consistent sha256 hash', () => {
      const h1 = computeHash('hello world');
      const h2 = computeHash('hello world');
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it('different content produces different hash', () => {
      expect(computeHash('a')).not.toBe(computeHash('b'));
    });
  });

  describe('getPendingFiles', () => {
    it('returns all files when manifest is empty', () => {
      const manifest: ProcessedManifest = { files: {} };
      const keys = ['raw/a.md', 'raw/b.md'];
      const contents = new Map([['raw/a.md', 'content a'], ['raw/b.md', 'content b']]);
      expect(getPendingFiles(keys, contents, manifest)).toEqual(keys);
    });

    it('excludes files with matching hash', () => {
      const content = 'hello';
      const hash = computeHash(content);
      const manifest: ProcessedManifest = {
        files: { 'raw/a.md': { processedAt: '', hash, space: 'articles', pages: [] } },
      };
      const contents = new Map([['raw/a.md', content], ['raw/b.md', 'new']]);
      expect(getPendingFiles(['raw/a.md', 'raw/b.md'], contents, manifest)).toEqual(['raw/b.md']);
    });

    it('includes files with changed hash', () => {
      const manifest: ProcessedManifest = {
        files: { 'raw/a.md': { processedAt: '', hash: 'sha256:old', space: 'articles', pages: [] } },
      };
      const contents = new Map([['raw/a.md', 'updated content']]);
      expect(getPendingFiles(['raw/a.md'], contents, manifest)).toEqual(['raw/a.md']);
    });
  });

  describe('addToManifest', () => {
    it('adds entry to manifest', () => {
      const manifest: ProcessedManifest = { files: {} };
      const result = addToManifest(manifest, 'raw/a.md', 'sha256:abc', 'articles', ['articles/sources/a.md']);
      expect(result.files['raw/a.md']).toBeDefined();
      expect(result.files['raw/a.md'].hash).toBe('sha256:abc');
      expect(result.files['raw/a.md'].space).toBe('articles');
      expect(result.files['raw/a.md'].pages).toEqual(['articles/sources/a.md']);
    });
  });
});
