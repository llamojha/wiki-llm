import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isInAllowedScope, readDocument, searchVault, type ScopeMode } from '@/lib/agent-tools';
import { invalidateSearchIndex } from '@/lib/search';
import { __resetWith } from '@/lib/s3-mock';
import { __resetVaultMode } from '@/lib/vault-mode';

/**
 * Characterization tests for the agent read-scope gate. `isInAllowedScope`
 * decides which S3 keys the Bedrock agent may read (via `searchVault` and
 * `readDocument`). The most important row is the v1 postmortem case: a naive
 * `startsWith('generated/')` check leaked `users/<id>/generated/...` keys into
 * shared scope. These tests pin the current, correct behavior so a refactor
 * can't silently reintroduce that leak.
 */
describe('isInAllowedScope', () => {
  const ALICE = 'alice';

  // key → expected result under each mode (user/both evaluated as alice).
  const matrix: Array<{
    key: string;
    shared: boolean;
    user: boolean;
    both: boolean;
    note?: string;
  }> = [
    { key: 'generated/wiki/a.md', shared: true, user: false, both: true },
    { key: 'authored/wiki/a.md', shared: true, user: false, both: true },
    {
      key: 'users/alice/generated/wiki/a.md',
      shared: false, // postmortem case: must NOT leak into shared scope
      user: true,
      both: true,
    },
    {
      key: 'users/alice/authored/personal/a.md',
      shared: false,
      user: true,
      both: true,
    },
    {
      key: 'users/bob/authored/personal/a.md',
      shared: false,
      user: false, // cross-user: alice cannot read bob's subtree
      both: false,
    },
    {
      // `_system/` is shared by key-shape inference; gating that keys of this
      // shape are off-limits is the docs route's job (plan 002), not this
      // function's. This row documents current behavior only.
      key: '_system/usage-log.jsonl',
      shared: true,
      user: false,
      both: true,
    },
  ];

  for (const row of matrix) {
    it(`${row.key}: shared=${row.shared} user=${row.user} both=${row.both}`, () => {
      expect(isInAllowedScope(row.key, 'shared')).toBe(row.shared);
      expect(isInAllowedScope(row.key, 'user', ALICE)).toBe(row.user);
      expect(isInAllowedScope(row.key, 'both', ALICE)).toBe(row.both);
    });
  }

  it('does not leak user-scoped generated keys into shared scope (v1 postmortem)', () => {
    // The exact leak shape from the postmortem, asserted on its own so a
    // failure names the regression directly.
    expect(isInAllowedScope('users/alice/generated/wiki/foo.md', 'shared')).toBe(false);
    expect(isInAllowedScope('generated/wiki/foo.md', 'shared')).toBe(true);
  });

  it('does not let a shared key satisfy user scope', () => {
    expect(isInAllowedScope('generated/wiki/foo.md', 'user', ALICE)).toBe(false);
  });

  it('falls back to the default user id when none is passed', () => {
    // With NEXT_PUBLIC_VAULT_USER_ID unset the default id is "default".
    expect(isInAllowedScope('users/default/authored/wiki/x.md', 'user')).toBe(true);
    expect(isInAllowedScope('users/alice/authored/wiki/x.md', 'user')).toBe(false);
  });

  it('rejects other users under both scope', () => {
    const modes: ScopeMode[] = ['shared', 'user', 'both'];
    for (const mode of modes) {
      expect(isInAllowedScope('users/bob/generated/wiki/x.md', mode, ALICE)).toBe(false);
    }
  });
});

/**
 * `readDocument` must apply the same document-key allowlist as
 * `GET /api/docs/{id}` (plan 002). Scope inference alone classifies
 * `_system/…` and `raw/…` as shared, so without `isDocumentKey` a
 * prompt-injected model could read vault system state through the tool.
 */
describe('readDocument key allowlist', () => {
  beforeEach(() => {
    __resetVaultMode();
    __resetWith({
      '_system/structure.json': '{"spaces":[]}', // sniffs the vault as provenance
      'generated/wiki/readable.md': '---\ntitle: Readable\n---\n# Readable\n\nBody.',
      'raw/upload.md': 'un-curated raw upload',
    });
  });

  it('reads a real document in scope', async () => {
    const doc = await readDocument({ doc_id: 'generated/wiki/readable.md' }, 'shared');
    expect(doc.title).toBe('Readable');
    expect(doc.body).toContain('Body.');
  });

  const blocked = [
    '_system/structure.json',
    '_system/usage-log.jsonl',
    'raw/upload.md',
    '_themes/evil.css',
  ];
  for (const key of blocked) {
    it(`denies non-document key ${key} in every scope mode`, async () => {
      for (const mode of ['shared', 'user', 'both'] as ScopeMode[]) {
        await expect(readDocument({ doc_id: key }, mode)).rejects.toThrow(/denied/);
      }
    });
  }
});

/**
 * A pinned space narrows the agent *within* the active scope. The UI tells the
 * user their context is that space, so `readDocument` must refuse everything
 * outside it — a prompt-injected "just read this other file" has to fail the
 * same way an out-of-scope key does.
 */
describe('readDocument pinned space', () => {
  beforeEach(() => {
    __resetVaultMode();
    __resetWith({
      '_system/structure.json': '{"spaces":[]}', // sniffs the vault as provenance
      'generated/wiki/in.md': '---\ntitle: In\n---\n# In\n\nBody.',
      'authored/notes/out.md': '---\ntitle: Out\n---\n# Out\n\nBody.',
      'users/default/authored/wiki/mine.md': '---\ntitle: Mine\n---\n# Mine\n\nBody.',
    });
  });

  it('reads a document inside the pinned space', async () => {
    const doc = await readDocument({ doc_id: 'generated/wiki/in.md' }, 'both', undefined, 'wiki');
    expect(doc.title).toBe('In');
  });

  it('matches the space across provenance roots and the user mirror', async () => {
    const doc = await readDocument(
      { doc_id: 'users/default/authored/wiki/mine.md' },
      'both',
      undefined,
      'wiki',
    );
    expect(doc.title).toBe('Mine');
  });

  it('denies a document in another space', async () => {
    await expect(
      readDocument({ doc_id: 'authored/notes/out.md' }, 'both', undefined, 'wiki'),
    ).rejects.toThrow(/outside the pinned space/);
  });

  it('reads across spaces when none is pinned', async () => {
    const doc = await readDocument({ doc_id: 'authored/notes/out.md' }, 'both');
    expect(doc.title).toBe('Out');
  });

  it('does not let a pinned space widen the scope gate', async () => {
    // `wiki` exists in the user mirror too, but shared scope still excludes it.
    await expect(
      readDocument({ doc_id: 'users/default/authored/wiki/mine.md' }, 'shared', undefined, 'wiki'),
    ).rejects.toThrow(/denied/);
  });
});

/**
 * Managed mode files pages under `pages/<space>/…` while the tree — and so the
 * context pill — offers the bare space. Frontmatter `space` is the canonical
 * grouping there, so a page filed under a space its key doesn't reflect is
 * still in that space and must stay readable when it's pinned.
 */
describe('readDocument pinned space (managed mode)', () => {
  beforeEach(() => {
    __resetVaultMode();
    __resetWith({
      // The marker is what makes the sniff resolve managed (mock S3 re-sniffs
      // on every ensureVaultMode, so __setVaultMode alone would not survive).
      '_system/managed.json': '{"version":1}',
      'pages/wiki/canonical.md': '---\ntitle: Canonical\n---\n# Canonical\n\nBody.',
      'pages/notes/refiled.md': '---\ntitle: Refiled\nspace: wiki\n---\n# Refiled\n\nBody.',
      'pages/notes/other.md': '---\ntitle: Other\n---\n# Other\n\nBody.',
    });
  });
  afterEach(() => __resetVaultMode());

  it('reads a canonical pages/<space>/ document', async () => {
    const doc = await readDocument({ doc_id: 'pages/wiki/canonical.md' }, 'both', undefined, 'wiki');
    expect(doc.title).toBe('Canonical');
  });

  it('honors frontmatter space over the key path', async () => {
    const doc = await readDocument({ doc_id: 'pages/notes/refiled.md' }, 'both', undefined, 'wiki');
    expect(doc.title).toBe('Refiled');
  });

  it('still denies a page that is in neither by key nor by frontmatter', async () => {
    await expect(
      readDocument({ doc_id: 'pages/notes/other.md' }, 'both', undefined, 'wiki'),
    ).rejects.toThrow(/outside the pinned space/);
  });
});

/**
 * The scope and space filters run *after* the ranker, so the fetch must be
 * unbounded — a capped fetch lets globally-higher-ranked out-of-space hits
 * starve the filter, and the agent reports no sources for documents that exist.
 */
describe('searchVault filter starvation', () => {
  beforeEach(() => {
    __resetVaultMode();
    const seed: Record<string, string> = {};
    // 40 strong matches outside the pinned space, one inside it.
    for (let i = 0; i < 40; i++) {
      seed[`notes/widget-${i}.md`] = '---\ntitle: Widget Report\n---\n\nWidget report body.';
    }
    seed['wiki/widget.md'] = '---\ntitle: Widget Report\n---\n\nWidget report body.';
    __resetWith(seed);
    invalidateSearchIndex();
  });
  afterEach(() => {
    __resetVaultMode();
    invalidateSearchIndex();
  });

  it('finds the in-space document behind many higher-ranked outside hits', async () => {
    const hits = await searchVault({ query: 'widget report', limit: 8 }, 'both', undefined, 'wiki');
    expect(hits.map((h) => h.id)).toEqual(['wiki/widget.md']);
  });

  it('is unfiltered without a pinned space', async () => {
    const hits = await searchVault({ query: 'widget report', limit: 8 }, 'both');
    expect(hits).toHaveLength(8);
  });
});
