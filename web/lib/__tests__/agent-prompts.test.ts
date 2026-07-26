import { describe, expect, it } from 'vitest';

import { buildSystemPrompt, filterCatalogToSpace } from '@/lib/agent-prompts';

/**
 * The catalog is what the model reads *before* it calls any tool, so a pinned
 * space has to be applied there too — otherwise the model reads an entry it
 * can see in the prompt and gets a refusal from `read_document`.
 */
describe('filterCatalogToSpace', () => {
  const catalog = [
    '### Shared library',
    '',
    '- generated/wiki/a.md — A — first doc',
    '- authored/wiki/b.md — B — second doc',
    '- authored/notes/c.md — C — third doc',
    '',
    '---',
    '',
    '### My library (default)',
    '',
    '- users/default/authored/wiki/d.md — D — fourth doc',
    '- users/default/authored/personal/e.md — E — fifth doc',
  ].join('\n');

  it('keeps only the pinned space, across scopes and provenance roots', () => {
    expect(filterCatalogToSpace(catalog, 'wiki')).toBe(
      [
        '- generated/wiki/a.md — A — first doc',
        '- authored/wiki/b.md — B — second doc',
        '- users/default/authored/wiki/d.md — D — fourth doc',
      ].join('\n'),
    );
  });

  it('drops section headers, which would otherwise label empty sections', () => {
    expect(filterCatalogToSpace(catalog, 'personal')).toBe(
      '- users/default/authored/personal/e.md — E — fifth doc',
    );
  });

  it('returns the catalog untouched when no space is pinned', () => {
    expect(filterCatalogToSpace(catalog, '')).toBe(catalog);
  });
});

describe('buildSystemPrompt pinned space', () => {
  it('tells the model the boundary exists so it can say "not in this space"', () => {
    const prompt = buildSystemPrompt({ catalog: '', scopeMode: 'both', contextSpace: 'wiki' });
    expect(prompt).toContain('Pinned space: **wiki**');
  });

  it('omits the line when nothing is pinned', () => {
    const prompt = buildSystemPrompt({ catalog: '', scopeMode: 'both' });
    expect(prompt).not.toContain('Pinned space');
  });
});
