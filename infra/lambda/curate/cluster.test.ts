import { describe, expect, it } from '@jest/globals';
import {
  MIN_CLUSTER_SIZE,
  clusterSourceCards,
  computeClusterHash,
  normalizeTitle,
} from './cluster.js';
import type { SourceCard } from './types.js';

/** Build a source-card with sensible defaults for tests. */
function card(
  overrides: Partial<SourceCard> & { rawKey: string; title: string },
): SourceCard {
  return {
    summary: `${overrides.title} summary`,
    claims: [],
    entities: [],
    concepts: [],
    suggestedSpaces: [],
    suggestedPages: [],
    tags: [],
    ...overrides,
  };
}

/** Wrap a SourceCard with the augmented fields the clusterer expects. */
function entry(c: SourceCard, hash: string, sourcePage = `generated/wiki/sources/${hash.slice(0, 8)}.md`) {
  return { card: c, cardHash: `sha256:${hash}`, sourcePage };
}

describe('normalizeTitle', () => {
  it('lowercases and strips articles', () => {
    expect(normalizeTitle('The Backstage Plugin Configuration')).toBe(
      'backstage plugin configuration',
    );
  });

  it('collapses whitespace and punctuation', () => {
    expect(normalizeTitle('GitHub  Integration—with  Backstage!')).toBe(
      'github integration with backstage',
    );
  });

  it('produces the same key for "A Plugin" and "Plugin"', () => {
    expect(normalizeTitle('A Plugin')).toBe(normalizeTitle('Plugin'));
  });
});

describe('computeClusterHash', () => {
  it('is order-independent', () => {
    const a = computeClusterHash(['sha256:a', 'sha256:b', 'sha256:c']);
    const b = computeClusterHash(['sha256:c', 'sha256:a', 'sha256:b']);
    expect(a).toBe(b);
  });

  it('changes when a member changes', () => {
    const a = computeClusterHash(['sha256:a', 'sha256:b']);
    const b = computeClusterHash(['sha256:a', 'sha256:c']);
    expect(a).not.toBe(b);
  });
});

describe('clusterSourceCards', () => {
  it('clusters cards sharing a suggestedPage', () => {
    const cards = [
      entry(
        card({
          rawKey: 'raw/projects/backstage-spike/README.md',
          title: 'Backstage Spike README',
          suggestedPages: ['Backstage Plugin Configuration', 'GitHub Integration with Backstage'],
          entities: ['Backstage', 'GitHub'],
          tags: ['backstage', 'plugins'],
        }),
        'a1',
      ),
      entry(
        card({
          rawKey: 'raw/projects/aivaro/PRD.md',
          title: 'AIvaro PRD',
          suggestedPages: ['GitHub Integration with Backstage', 'AIvaro Workflow Automation'],
          entities: ['Backstage', 'AIvaro'],
          tags: ['aivaro', 'github'],
        }),
        'a2',
      ),
      entry(
        card({
          rawKey: 'raw/projects/aivaro/roadmap.md',
          title: 'AIvaro Roadmap',
          suggestedPages: ['AIvaro Workflow Automation', 'AIvaro Architecture'],
          tags: ['aivaro'],
        }),
        'a3',
      ),
    ];

    const clusters = clusterSourceCards(cards);

    // "GitHub Integration with Backstage" → 2 contributors → kept
    // "AIvaro Workflow Automation" → 2 contributors → kept
    // singletons (Backstage Plugin Configuration, AIvaro Architecture) → dropped
    expect(clusters.map((c) => c.title).sort()).toEqual([
      'AIvaro Workflow Automation',
      'GitHub Integration with Backstage',
    ]);
  });

  it('drops clusters below MIN_CLUSTER_SIZE', () => {
    const cards = [
      entry(card({ rawKey: 'r/a.md', title: 'A', suggestedPages: ['Solo Topic'] }), 'a1'),
    ];
    expect(clusterSourceCards(cards)).toEqual([]);
  });

  it('falls back to concepts[] when suggestedPages is empty', () => {
    const cards = [
      entry(card({ rawKey: 'r/a.md', title: 'A', concepts: ['Event Sourcing'] }), 'a1'),
      entry(card({ rawKey: 'r/b.md', title: 'B', concepts: ['Event Sourcing'] }), 'a2'),
    ];
    const clusters = clusterSourceCards(cards);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].title).toBe('Event Sourcing');
  });

  it('prefers suggestedPages over concepts when both are present', () => {
    const cards = [
      entry(
        card({
          rawKey: 'r/a.md',
          title: 'A',
          suggestedPages: ['Plugin System'],
          concepts: ['Event Sourcing'],
        }),
        'a1',
      ),
      entry(
        card({
          rawKey: 'r/b.md',
          title: 'B',
          suggestedPages: ['Plugin System'],
          concepts: ['Event Sourcing'],
        }),
        'a2',
      ),
    ];
    const clusters = clusterSourceCards(cards);
    // concepts must NOT contribute to clustering when suggestedPages exists.
    expect(clusters.map((c) => c.title)).toEqual(['Plugin System']);
  });

  it('produces a stable clusterHash for the same inputs in any order', () => {
    const a = card({ rawKey: 'r/a.md', title: 'A', suggestedPages: ['X'] });
    const b = card({ rawKey: 'r/b.md', title: 'B', suggestedPages: ['X'] });

    const c1 = clusterSourceCards([entry(a, 'a1'), entry(b, 'a2')]);
    const c2 = clusterSourceCards([entry(b, 'a2'), entry(a, 'a1')]);
    expect(c1[0].clusterHash).toBe(c2[0].clusterHash);
  });

  it('clusterHash changes when a contributing card is removed', () => {
    const a = card({ rawKey: 'r/a.md', title: 'A', suggestedPages: ['X'] });
    const b = card({ rawKey: 'r/b.md', title: 'B', suggestedPages: ['X'] });
    const c = card({ rawKey: 'r/c.md', title: 'C', suggestedPages: ['X'] });

    const full = clusterSourceCards([entry(a, 'a1'), entry(b, 'a2'), entry(c, 'a3')]);
    const partial = clusterSourceCards([entry(a, 'a1'), entry(b, 'a2')]);
    expect(full[0].clusterHash).not.toBe(partial[0].clusterHash);
  });

  it('categorizes Backstage (an entity) as a concept', () => {
    const cards = [
      entry(
        card({
          rawKey: 'r/a.md',
          title: 'A',
          suggestedPages: ['Backstage'],
          entities: ['Backstage'],
        }),
        'a1',
      ),
      entry(
        card({
          rawKey: 'r/b.md',
          title: 'B',
          suggestedPages: ['Backstage'],
          entities: ['Backstage'],
        }),
        'a2',
      ),
    ];
    expect(clusterSourceCards(cards)[0].category).toBe('concepts');
  });

  it('categorizes "GitHub Integration" as a feature via the hint word', () => {
    const cards = [
      entry(card({ rawKey: 'r/a.md', title: 'A', suggestedPages: ['GitHub Integration'] }), 'a1'),
      entry(card({ rawKey: 'r/b.md', title: 'B', suggestedPages: ['GitHub Integration'] }), 'a2'),
    ];
    expect(clusterSourceCards(cards)[0].category).toBe('features');
  });

  it('unions tags across contributors', () => {
    const cards = [
      entry(card({ rawKey: 'r/a.md', title: 'A', suggestedPages: ['X'], tags: ['a', 'shared'] }), 'a1'),
      entry(card({ rawKey: 'r/b.md', title: 'B', suggestedPages: ['X'], tags: ['b', 'shared'] }), 'a2'),
    ];
    expect(clusterSourceCards(cards)[0].tags).toEqual(['a', 'b', 'shared']);
  });

  it('deduplicates contributors when the same card lists a title twice', () => {
    const cards = [
      entry(
        card({
          rawKey: 'r/a.md',
          title: 'A',
          suggestedPages: ['Topic', 'Topic'], // duplicate from the model
        }),
        'a1',
      ),
      entry(card({ rawKey: 'r/b.md', title: 'B', suggestedPages: ['Topic'] }), 'a2'),
    ];
    const clusters = clusterSourceCards(cards);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toHaveLength(2);
  });
});

describe('MIN_CLUSTER_SIZE constant', () => {
  it('is 2 (the resolved default in synthesis-pipeline.md)', () => {
    expect(MIN_CLUSTER_SIZE).toBe(2);
  });
});
