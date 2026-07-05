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

  it('defaults to folders for a plain folder of Markdown', async () => {
    __resetWith({ 'notes/a.md': '# A', 'projects/b.md': '# B' });
    expect(await ensureVaultMode()).toBe('folders');
  });

  it('defaults to folders for an empty vault', async () => {
    __resetWith({});
    expect(await ensureVaultMode()).toBe('folders');
  });
});
