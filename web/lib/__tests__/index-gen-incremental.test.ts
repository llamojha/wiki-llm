import { beforeEach, describe, expect, it } from 'vitest';

import { getObject, putObject } from '@/lib/s3';
import { __resetWith } from '@/lib/s3-mock';
import { systemKey } from '@/lib/vault-paths';
import type { VaultStructure } from '@/lib/vault-structure';
import {
  patchMasterIndexForKey,
  patchSpaceIndexForKey,
  regenerateMasterIndex,
  regenerateSpaceIndex,
  removeKeyFromSpaceIndex,
} from '@/lib/index-gen';

/**
 * Plan 014: single-key writes patch the space and master index files in place
 * rather than re-listing and re-reading the whole space. The key invariant is
 * that a patched file is byte-identical to a full rebuild (modulo the
 * frontmatter `updated:` timestamp), so the two paths never drift.
 */

const STRUCTURE_KEY = systemKey('structure.json');
const SPACE_INDEX = systemKey('indexes/wiki.md');
const MASTER = systemKey('index.md');

const doc = (title: string) => `---\ntitle: ${title}\nsource_type: authored\n---\n${title} body content.`;

function structureWith(...names: string[]): VaultStructure {
  return {
    version: 3,
    spaces: names.map((name) => ({ name, label: name.toUpperCase(), indexed: true })),
  };
}

/** Compare modulo the volatile `updated:` frontmatter line. */
const stripUpdated = (s: string) => s.replace(/^updated: .*$/m, 'updated: <ts>');

describe('incremental space-index patching', () => {
  beforeEach(() => {
    __resetWith({
      [STRUCTURE_KEY]: JSON.stringify(structureWith('wiki'), null, 2),
      // generated is listed before authored by a full rebuild; keep that order.
      'generated/wiki/g.md': doc('Grape'),
      'authored/wiki/a.md': doc('Apple'),
      'authored/wiki/b.md': doc('Banana'),
    });
  });

  it('replaces exactly one line on edit, byte-equal to a full rebuild', async () => {
    await regenerateSpaceIndex('wiki');

    await putObject('authored/wiki/a.md', doc('Apricot'));
    await patchSpaceIndexForKey('authored/wiki/a.md');
    const patched = await getObject(SPACE_INDEX);

    await regenerateSpaceIndex('wiki');
    const full = await getObject(SPACE_INDEX);

    expect(stripUpdated(patched)).toBe(stripUpdated(full));
    expect(patched).toContain('- authored/wiki/a.md — Apricot — ');
    expect(patched).not.toContain('Apple');
  });

  it('inserts a new key in full-rebuild order', async () => {
    await regenerateSpaceIndex('wiki');

    await putObject('authored/wiki/c.md', doc('Cherry'));
    await patchSpaceIndexForKey('authored/wiki/c.md');
    const patched = await getObject(SPACE_INDEX);

    await regenerateSpaceIndex('wiki');
    const full = await getObject(SPACE_INDEX);

    expect(stripUpdated(patched)).toBe(stripUpdated(full));
  });

  it('removes a key line, leaving the rest intact', async () => {
    await regenerateSpaceIndex('wiki');

    await removeKeyFromSpaceIndex('authored/wiki/a.md');
    const after = await getObject(SPACE_INDEX);

    expect(after).not.toContain('- authored/wiki/a.md — ');
    expect(after).toContain('- authored/wiki/b.md — ');
    expect(after).toContain('- generated/wiki/g.md — ');
  });

  it('falls back to a full rebuild when no index file exists yet', async () => {
    // No prior regenerateSpaceIndex — the index file is absent.
    await patchSpaceIndexForKey('authored/wiki/a.md');
    const created = await getObject(SPACE_INDEX);

    // A full rebuild would list every doc in the space, not just the patched one.
    expect(created).toContain('- authored/wiki/a.md — Apple — ');
    expect(created).toContain('- authored/wiki/b.md — Banana — ');
    expect(created).toContain('- generated/wiki/g.md — Grape — ');
  });
});

describe('incremental master-index patching', () => {
  beforeEach(() => {
    __resetWith({
      [STRUCTURE_KEY]: JSON.stringify(structureWith('wiki'), null, 2),
      'generated/wiki/g.md': doc('Grape'),
      'authored/wiki/a.md': doc('Apple'),
      'authored/wiki/b.md': doc('Banana'),
    });
  });

  it('edits a line inside the space section, byte-equal to a full rebuild', async () => {
    await regenerateMasterIndex();

    await putObject('authored/wiki/a.md', doc('Apricot'));
    await patchMasterIndexForKey('authored/wiki/a.md');
    const patched = await getObject(MASTER);

    await regenerateMasterIndex();
    const full = await getObject(MASTER);

    expect(stripUpdated(patched)).toBe(stripUpdated(full));
    expect(patched).toContain('## Wiki');
    expect(patched).toContain('- authored/wiki/a.md — Apricot — ');
  });

  it('inserts a new key into the existing section in rebuild order', async () => {
    await regenerateMasterIndex();

    await putObject('authored/wiki/c.md', doc('Cherry'));
    await patchMasterIndexForKey('authored/wiki/c.md');
    const patched = await getObject(MASTER);

    await regenerateMasterIndex();
    const full = await getObject(MASTER);

    expect(stripUpdated(patched)).toBe(stripUpdated(full));
  });
});

describe('concurrent space-index writes (ETag CAS)', () => {
  beforeEach(() => {
    __resetWith({
      [STRUCTURE_KEY]: JSON.stringify(structureWith('wiki'), null, 2),
      'generated/wiki/seed.md': doc('Seed'),
    });
  });

  it('never drops an entry when two same-space patches race', async () => {
    await regenerateSpaceIndex('wiki'); // index lists only seed
    // Two new docs, neither yet in the index.
    await putObject('authored/wiki/a.md', doc('Alpha'));
    await putObject('authored/wiki/b.md', doc('Beta'));

    // Race their inserts. Without CAS the second writer reads the pre-insert
    // index and overwrites the first — permanently dropping one entry.
    await Promise.all([
      patchSpaceIndexForKey('authored/wiki/a.md'),
      patchSpaceIndexForKey('authored/wiki/b.md'),
    ]);

    const index = await getObject(SPACE_INDEX);
    expect(index).toContain('- generated/wiki/seed.md — ');
    expect(index).toContain('- authored/wiki/a.md — Alpha — ');
    expect(index).toContain('- authored/wiki/b.md — Beta — ');
  });
});
