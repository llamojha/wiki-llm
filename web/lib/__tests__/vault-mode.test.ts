import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetWith } from '@/lib/s3-mock';
import { __resetVaultMode, ensureVaultMode } from '@/lib/vault-mode';

/**
 * Mode detection: explicit env overrides the sniff; the sniff reads the vault
 * shape (structure.json or any generated/authored doc ⇒ provenance); a plain
 * folder of notes defaults to folders. Under MOCK_S3 the mode is re-sniffed
 * every call, so `__resetVaultMode()` + a fresh seed is enough to isolate cases.
 */
describe('ensureVaultMode', () => {
  beforeEach(() => {
    __resetWith({});
    __resetVaultMode();
    delete process.env.VAULT_MODE;
  });

  afterEach(() => {
    delete process.env.VAULT_MODE;
    __resetVaultMode();
  });

  it('honors an explicit VAULT_MODE=folders over a provenance-shaped vault', async () => {
    __resetWith({ '_system/structure.json': '{"version":3,"spaces":[]}' });
    process.env.VAULT_MODE = 'folders';
    expect(await ensureVaultMode()).toBe('folders');
  });

  it('honors an explicit VAULT_MODE=provenance over a plain folder vault', async () => {
    __resetWith({ 'notes/a.md': '# A' });
    process.env.VAULT_MODE = 'provenance';
    expect(await ensureVaultMode()).toBe('provenance');
  });

  it('sniffs provenance when structure.json exists (even with no docs)', async () => {
    __resetWith({ '_system/structure.json': '{"version":3,"spaces":[]}' });
    expect(await ensureVaultMode()).toBe('provenance');
  });

  it('sniffs provenance when a generated/ or authored/ doc is present', async () => {
    __resetWith({ 'generated/wiki/a.md': '# A' });
    expect(await ensureVaultMode()).toBe('provenance');
  });

  it('sniffs provenance for a user-scoped-only vault (no structure.json, no shared docs)', async () => {
    // The old personal-editor flow produces `users/<id>/authored/personal/*`
    // with no root structure.json and no shared generated/authored docs. Without
    // the user-scoped probe this would flip to `folders` on restart.
    __resetWith({ 'users/default/authored/personal/foo.md': '# Foo' });
    expect(await ensureVaultMode()).toBe('provenance');
  });

  it('sniffs provenance for user-scoped generated content', async () => {
    __resetWith({ 'users/default/generated/wiki/bar.md': '# Bar' });
    expect(await ensureVaultMode()).toBe('provenance');
  });

  it('does not treat a plain top-level users/ folder as provenance', async () => {
    // A folders-mode vault may legitimately have a `users/` folder of notes;
    // only the `users/*/(generated|authored)/` shape is a provenance signal.
    __resetWith({ 'users/alice/notes.md': '# Notes' });
    expect(await ensureVaultMode()).toBe('folders');
  });

  it('defaults to folders for a plain folder of Markdown', async () => {
    __resetWith({ 'notes/a.md': '# A', 'projects/b.md': '# B' });
    expect(await ensureVaultMode()).toBe('folders');
  });

  it('defaults to folders for an empty vault', async () => {
    __resetWith({});
    expect(await ensureVaultMode()).toBe('folders');
  });

  it('sniffs managed when the _system/managed.json marker exists', async () => {
    __resetWith({ '_system/managed.json': '{"version":1}', 'pages/wiki/a.md': '# A' });
    expect(await ensureVaultMode()).toBe('managed');
  });

  it('prefers the managed marker over a provenance-shaped vault', async () => {
    // The marker is the unambiguous managed signal; it must win even when a
    // structure.json is also present (e.g. a half-migrated provenance vault).
    __resetWith({
      '_system/managed.json': '{"version":1}',
      '_system/structure.json': '{"version":3,"spaces":[]}',
    });
    expect(await ensureVaultMode()).toBe('managed');
  });

  it('honors an explicit VAULT_MODE=managed over a plain folder vault', async () => {
    __resetWith({ 'notes/a.md': '# A' });
    process.env.VAULT_MODE = 'managed';
    expect(await ensureVaultMode()).toBe('managed');
  });

  it('does not sniff managed for a plain folder vault without the marker', async () => {
    __resetWith({ 'pages/wiki/a.md': '# A', 'notes/b.md': '# B' });
    expect(await ensureVaultMode()).toBe('folders');
  });
});
