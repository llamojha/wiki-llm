import { beforeEach, describe, expect, it } from 'vitest';

import { putObject } from '@/lib/s3';
import { __resetWith } from '@/lib/s3-mock';
import { systemKey } from '@/lib/vault-paths';
import {
  ensureSpaceInStructure,
  getStructure,
  mutableSpacesForScope,
  updateStructure,
  type VaultStructure,
} from '@/lib/vault-structure';
import { ConcurrencyError } from '@/lib/s3';

/**
 * `updateStructure` is the single compare-and-swap write path for
 * structure.json. These tests exercise it against the in-memory S3 mock
 * (MOCK_S3=1, set in vitest.config.ts) — the mock enforces the same `ifMatch`
 * ETag semantics as real S3, so a stale write throws `ConcurrencyError`.
 */

const STRUCTURE_KEY = systemKey('structure.json');

/** A minimal v3 structure with the given shared space names. */
function structureWith(...names: string[]): VaultStructure {
  return {
    version: 3,
    spaces: names.map((name) => ({ name, label: name.toUpperCase(), indexed: true })),
  };
}

function seed(structure: VaultStructure): void {
  __resetWith({ [STRUCTURE_KEY]: JSON.stringify(structure, null, 2) });
}

async function sharedSpaceNames(): Promise<string[]> {
  return (await getStructure()).spaces.map((s) => s.name);
}

describe('updateStructure (structure.json CAS)', () => {
  beforeEach(() => {
    __resetWith({});
  });

  it('persists a mutation; a second read sees it', async () => {
    seed(structureWith('a'));

    await updateStructure((s) => {
      mutableSpacesForScope(s, 'shared').push({ name: 'b', label: 'B', indexed: true });
      return true;
    });

    expect(await sharedSpaceNames()).toEqual(['a', 'b']);
  });

  it('writes the first structure unconditionally when none exists', async () => {
    // Empty store — getStructureWithETag yields the default with etag=null.
    await updateStructure((s) => {
      mutableSpacesForScope(s, 'shared').push({ name: 'a', label: 'A', indexed: true });
      return true;
    });

    expect(await sharedSpaceNames()).toEqual(['a']);
  });

  it('no-op callback (returns false) does not write', async () => {
    seed(structureWith('a'));
    const before = JSON.stringify(await getStructure());

    await updateStructure(() => false);

    // A write would re-serialize (and, via ifMatch, bump the ETag); assert the
    // stored bytes are byte-for-byte unchanged.
    expect(JSON.stringify(await getStructure())).toBe(before);
  });

  it('retries on conflict so a concurrent change is not lost', async () => {
    seed(structureWith('a'));

    let injected = false;
    await updateStructure(async (s) => {
      mutableSpacesForScope(s, 'shared').push({ name: 'b', label: 'B', indexed: true });
      if (!injected) {
        injected = true;
        // A concurrent writer lands space "c" and bumps the ETag between our
        // read and our conditional put — the classic lost-update setup.
        const other = await getStructure();
        mutableSpacesForScope(other, 'shared').push({ name: 'c', label: 'C', indexed: true });
        await putObject(STRUCTURE_KEY, JSON.stringify(other, null, 2));
      }
      return true;
    });

    // Both the concurrent change (c) and this call's change (b) survive.
    expect(await sharedSpaceNames()).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    expect((await getStructure()).spaces).toHaveLength(3);
  });

  it('rethrows ConcurrencyError after exhausting retries', async () => {
    seed(structureWith('a'));

    let n = 0;
    await expect(
      updateStructure(async (s) => {
        mutableSpacesForScope(s, 'shared').push({ name: 'x', label: 'X', indexed: true });
        // Bump the stored ETag on every attempt so the conditional put always
        // conflicts — unique content each time keeps the ETag moving.
        n += 1;
        const other = await getStructure();
        mutableSpacesForScope(other, 'shared').push({ name: `z${n}`, label: 'Z', indexed: true });
        await putObject(STRUCTURE_KEY, JSON.stringify(other, null, 2));
        return true;
      }),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('propagates a non-ConcurrencyError thrown from the callback without retry', async () => {
    seed(structureWith('a'));

    let calls = 0;
    await expect(
      updateStructure(() => {
        calls += 1;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(calls).toBe(1);
  });
});

describe('ensureSpaceInStructure', () => {
  beforeEach(() => {
    __resetWith({});
  });

  it('adds a missing space', async () => {
    seed(structureWith());
    await ensureSpaceInStructure('wiki');
    expect(await sharedSpaceNames()).toEqual(['wiki']);
  });

  it('is idempotent — declaring an existing space does not duplicate it', async () => {
    seed(structureWith('wiki'));
    await ensureSpaceInStructure('wiki');
    expect(await sharedSpaceNames()).toEqual(['wiki']);
  });
});
