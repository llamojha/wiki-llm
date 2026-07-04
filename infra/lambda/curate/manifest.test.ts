import { describe, it, expect } from '@jest/globals';
import {
  addToManifest,
  computeHash,
  getPendingFiles,
  ManifestConflictError,
  manifestEntry,
  mergeWithRetry,
} from './manifest.js';
import type { ProcessedFileEntry, ProcessedManifest } from './types.js';

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

  describe('mergeWithRetry (manifest compare-and-swap)', () => {
    const entry = (hash: string): ProcessedFileEntry =>
      manifestEntry(hash, 'articles', [`articles/sources/${hash}.md`]);

    it('merges the entry into the manifest and writes it', async () => {
      let written: ProcessedManifest | undefined;
      await mergeWithRetry(
        async () => ({ manifest: { files: {} }, etag: 'v1' }),
        async (m) => { written = m; },
        'raw/a.md',
        entry('a'),
      );
      expect(written?.files['raw/a.md']).toEqual(entry('a'));
    });

    it('creates unconditionally (If-None-Match: *, no ifMatch) when no manifest exists yet', async () => {
      let seenIfMatch: string | undefined = 'sentinel';
      let createCalled = false;
      await mergeWithRetry(
        async () => ({ manifest: { files: {} }, etag: null }),
        async (_m, ifMatch) => { seenIfMatch = ifMatch; },
        'raw/a.md',
        entry('a'),
        undefined,
        async () => { createCalled = true; },
      );
      expect(createCalled).toBe(true);
      expect(seenIfMatch).toBe('sentinel');
    });

    it('retries via create when a racing first-writer wins the create', async () => {
      // Both invocations see etag: null. The injected create throws
      // ManifestConflictError once (losing the race), then the retry re-reads
      // and this time observes the winner's etag, taking the CAS write path.
      let createAttempts = 0;
      let sawEtag: string | null = null;
      await mergeWithRetry(
        async () => (createAttempts === 0 ? { manifest: { files: {} }, etag: null } : { manifest: { files: { a: entry('a') } }, etag: 'v1' }),
        async (_m, ifMatch) => { sawEtag = ifMatch ?? null; },
        'raw/b.md',
        entry('b'),
        undefined,
        async () => {
          createAttempts += 1;
          if (createAttempts === 1) throw new ManifestConflictError();
        },
      );
      expect(createAttempts).toBe(1);
      expect(sawEtag).toBe('v1');
    });

    it('re-reads on conflict so a concurrent entry is not lost', async () => {
      // A pre-existing entry `a`; this call adds `b`; a concurrent writer lands
      // `c` between our read and our write, bumping the ETag → 412 on attempt 1.
      const store = {
        manifest: { files: { a: entry('a') } } as ProcessedManifest,
        etag: 'v0',
        writes: 0,
      };
      const write = async (m: ProcessedManifest, ifMatch?: string) => {
        if (ifMatch !== store.etag) throw new ManifestConflictError();
        store.manifest = m;
        store.etag = `v${++store.writes}`;
      };
      let injected = false;
      const read = async () => {
        const snapshot = { manifest: store.manifest, etag: store.etag };
        if (!injected) {
          injected = true;
          store.manifest = { files: { ...store.manifest.files, c: entry('c') } };
          store.etag = 'vX';
        }
        return snapshot; // deliberately stale — old etag, pre-`c` files
      };

      await mergeWithRetry(read, write, 'b', entry('b'));

      expect(Object.keys(store.manifest.files).sort()).toEqual(['a', 'b', 'c']);
    });

    it('throws ManifestConflictError after exhausting retries', async () => {
      await expect(
        mergeWithRetry(
          async () => ({ manifest: { files: {} }, etag: 'always-stale' }),
          async () => { throw new ManifestConflictError(); },
          'raw/a.md',
          entry('a'),
          3,
        ),
      ).rejects.toBeInstanceOf(ManifestConflictError);
    });

    it('propagates a non-conflict write error without retrying', async () => {
      let attempts = 0;
      await expect(
        mergeWithRetry(
          async () => ({ manifest: { files: {} }, etag: 'v1' }),
          async () => { attempts += 1; throw new Error('AccessDenied'); },
          'raw/a.md',
          entry('a'),
        ),
      ).rejects.toThrow('AccessDenied');
      expect(attempts).toBe(1);
    });
  });
});
