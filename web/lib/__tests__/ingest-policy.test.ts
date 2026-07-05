import { describe, expect, it } from 'vitest';

import { isIngestError, resolveFoldersIngest } from '@/lib/ingest-policy';

/**
 * Folders-mode curate routing (plan 026): validate + normalize the
 * caller-chosen source and destination folders. No provenance roots, no
 * structure.json — just two folder paths in the single-tenant tree.
 */
describe('resolveFoldersIngest', () => {
  it('accepts a valid source + destination', () => {
    const policy = resolveFoldersIngest('inbox', 'wiki/guides');
    expect(isIngestError(policy)).toBe(false);
    if (isIngestError(policy)) return;
    expect(policy).toEqual({
      mode: 'folders',
      source: 'inbox',
      destination: 'wiki/guides',
      sourcePrefix: 'inbox/',
    });
  });

  it('allows an empty source (whole vault root) with a real destination', () => {
    const policy = resolveFoldersIngest('', 'curated');
    expect(isIngestError(policy)).toBe(false);
    if (isIngestError(policy)) return;
    expect(policy.source).toBe('');
    expect(policy.sourcePrefix).toBe('');
    expect(policy.destination).toBe('curated');
  });

  it('requires a destination', () => {
    const policy = resolveFoldersIngest('inbox', '');
    expect(isIngestError(policy)).toBe(true);
    if (!isIngestError(policy)) return;
    expect(policy.error).toContain('destination folder is required');
  });

  it('rejects a destination under _system/', () => {
    expect(isIngestError(resolveFoldersIngest('inbox', '_system'))).toBe(true);
    expect(isIngestError(resolveFoldersIngest('inbox', '_system/jobs'))).toBe(true);
  });

  it('rejects source === destination (no self-ingest)', () => {
    const policy = resolveFoldersIngest('notes', 'notes');
    expect(isIngestError(policy)).toBe(true);
    if (!isIngestError(policy)) return;
    expect(policy.error).toContain('must differ');
  });

  it('rejects malformed folder segments', () => {
    expect(isIngestError(resolveFoldersIngest('../etc', 'wiki'))).toBe(true);
    expect(isIngestError(resolveFoldersIngest('inbox', 'Bad Space'))).toBe(true);
    expect(isIngestError(resolveFoldersIngest('inbox', 'UPPER'))).toBe(true);
  });
});
