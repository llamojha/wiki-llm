import { beforeEach, describe, expect, it } from 'vitest';

import { isInAllowedScope, readDocument, type ScopeMode } from '@/lib/agent-tools';
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
