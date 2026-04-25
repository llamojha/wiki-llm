import { describe, expect, it } from '@jest/globals';
import {
  parseSourceCard,
  renderSourcePage,
  resolveOutputSpace,
  sourceSlug,
  spaceFromRawKey,
} from './source-card.js';

describe('source cards', () => {
  it('parses fenced JSON source-card responses', () => {
    const card = parseSourceCard(`\`\`\`json
{
  "title": "Event Sourcing Notes",
  "summary": "Explains event sourcing tradeoffs.",
  "claims": [{ "text": "Events are append-only.", "evidence": "Section 2" }],
  "entities": ["Acme Platform"],
  "concepts": ["Event Sourcing"],
  "suggestedSpaces": ["Architecture"],
  "suggestedPages": ["Event Sourcing"],
  "tags": ["Architecture", "Events"]
}
\`\`\``, 'raw/event-sourcing.md');

    expect(card.rawKey).toBe('raw/event-sourcing.md');
    expect(card.title).toBe('Event Sourcing Notes');
    expect(card.claims[0]).toEqual({ text: 'Events are append-only.', evidence: 'Section 2' });
    expect(card.suggestedSpaces).toEqual(['architecture']);
    expect(card.tags).toEqual(['architecture', 'events']);
  });

  it('renders deterministic source pages with provenance', () => {
    const card = parseSourceCard(JSON.stringify({
      title: 'Tracing Guide',
      summary: 'A guide to service tracing.',
      claims: ['Tracing improves incident debugging.'],
      entities: [],
      concepts: ['Distributed Tracing'],
      suggestedSpaces: [],
      suggestedPages: [],
      tags: ['observability'],
    }), 'raw/tracing.md');

    const rendered = renderSourcePage(card, 'raw/tracing.md', 'sha256:abc123');
    expect(rendered).toContain('title: "Tracing Guide"');
    expect(rendered).toContain('raw_key: "raw/tracing.md"');
    expect(rendered).toContain('raw_hash: "sha256:abc123"');
    expect(rendered).toContain('- [[Distributed Tracing]]');
  });

  it('uses a hash suffix for source page slugs', () => {
    const card = parseSourceCard(JSON.stringify({
      title: 'Tracing Guide',
      summary: 'A guide to service tracing.',
      claims: [],
      entities: [],
      concepts: [],
      suggestedSpaces: [],
      suggestedPages: [],
      tags: [],
    }), 'raw/tracing.md');

    expect(sourceSlug(card, 'raw/tracing.md', 'sha256:abcdef123456')).toBe('tracing-guide-abcdef12');
  });

  it('resolves __all to the first suggested space or inbox', () => {
    const card = parseSourceCard(JSON.stringify({
      title: 'Inbox Source',
      summary: 'A source without a clear space.',
      claims: [],
      entities: [],
      concepts: [],
      suggestedSpaces: ['Research'],
      suggestedPages: [],
      tags: [],
    }), 'raw/source.md');

    expect(resolveOutputSpace('__all', card)).toBe('research');
    expect(resolveOutputSpace('docs', card)).toBe('docs');
  });

  it('does not choose personal for root raw files in all-space mode', () => {
    const card = parseSourceCard(JSON.stringify({
      title: 'Shared Source',
      summary: 'A source that should not default to personal.',
      claims: [],
      entities: [],
      concepts: [],
      suggestedSpaces: ['personal', 'research'],
      suggestedPages: [],
      tags: [],
    }), 'raw/source.md');

    expect(resolveOutputSpace('__all', card)).toBe('research');
  });

  it('infers existing space from space-scoped raw keys', () => {
    expect(spaceFromRawKey('research/raw/source.md')).toBe('research');
    expect(spaceFromRawKey('personal/raw/source.md')).toBe('personal');
    expect(spaceFromRawKey('raw/source.md')).toBeNull();
  });

  it('renders placement in frontmatter when set', () => {
    const card = parseSourceCard(JSON.stringify({
      title: 'Tracing Guide',
      summary: 'A guide.',
      claims: [],
      entities: [],
      concepts: [],
      suggestedSpaces: [],
      suggestedPages: [],
      tags: [],
    }), 'raw/projects/CodeMMORPG/tracing.md');

    const withPlacement = { ...card, placement: 'projects/codemmorpg' };
    const rendered = renderSourcePage(withPlacement, 'raw/projects/CodeMMORPG/tracing.md', 'sha256:abc123');
    expect(rendered).toContain('placement: "projects/codemmorpg"');
  });

  it('omits the placement frontmatter line when placement is undefined', () => {
    const card = parseSourceCard(JSON.stringify({
      title: 'Legacy Card',
      summary: 'Pre-placement card.',
      claims: [],
      entities: [],
      concepts: [],
      suggestedSpaces: [],
      suggestedPages: [],
      tags: [],
    }), 'raw/legacy.md');

    const rendered = renderSourcePage(card, 'raw/legacy.md', 'sha256:abc123');
    expect(rendered).not.toContain('placement:');
  });
});
