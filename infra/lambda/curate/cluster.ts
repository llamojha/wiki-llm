import { createHash } from 'node:crypto';
import type { SourceCard } from './types.js';
import { slugifyLabel } from './source-card.js';

/**
 * Pure clustering logic for the synthesis pass. See specs/synthesis-pipeline.md
 * — this module implements task #2 (clusterSourceCards) of the implementation
 * checklist. No I/O; takes source-cards in, returns clusters out.
 */

export const MIN_CLUSTER_SIZE = 2;
export const MAX_CLUSTERS_PER_RUN = 100;

export type ClusterCategory = 'concepts' | 'features' | 'projects';

export type ClusterMember = {
  /** Hash of the source-card (from `_system/source-cards/<hash>.json`). */
  cardHash: string;
  /** S3 key of the source-card's published page (`generated/<space>/sources/<slug>.md`). */
  sourcePage: string;
  /** Position in the cluster (1-based) for citation markers in the synthesized page. */
  citationIndex: number;
};

export type Cluster = {
  /** Display title for the rollup page (the dominant suggestedPage from contributors). */
  title: string;
  /** Slug derived from the normalized title. Used as the filename stem. */
  slug: string;
  /** Concept/feature/project — determines which folder the page lands in. */
  category: ClusterCategory;
  /** Source-cards contributing to this cluster, in stable order. */
  members: ClusterMember[];
  /** Union of contributors' tags, deduplicated. */
  tags: string[];
  /** Deterministic hash of the sorted member card-hashes — for idempotency. */
  clusterHash: string;
};

/** Articles dropped from cluster-title normalization so "The X" and "X" collide. */
const STOP_ARTICLES = new Set(['a', 'an', 'the']);

/** Verbs/nouns in a cluster title that hint it's a feature, not a concept. */
const FEATURE_HINTS = ['integration', 'automation', 'workflow', 'pipeline', 'deployment', 'sync'];

/**
 * Normalize a cluster title for grouping. Lowercase, strip leading articles,
 * collapse whitespace, drop punctuation that doesn't affect identity. The
 * normalized form is the cluster key; the display title is the most common
 * raw form among contributors.
 */
export function normalizeTitle(title: string): string {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter((w) => w && !STOP_ARTICLES.has(w));
  return words.join(' ');
}

/**
 * Pick the rollup category for a cluster. Heuristic per spec:
 *  - cluster title appears verbatim in any contributor's `entities[]` → `concepts`
 *  - title contains a feature-shaped word → `features`
 *  - title matches a configured project name → `projects`
 *  - else default `concepts`
 *
 * `projectNames` is a set of normalized project titles drawn from
 * `_system/structure.json` (passed by the orchestrator). Empty when no
 * projects are declared, which is the case today.
 */
export function categorizeCluster(
  normalizedTitle: string,
  members: SourceCard[],
  projectNames: Set<string>,
): ClusterCategory {
  if (projectNames.has(normalizedTitle)) return 'projects';

  const titleWords = new Set(normalizedTitle.split(' '));
  for (const hint of FEATURE_HINTS) {
    if (titleWords.has(hint)) return 'features';
  }

  for (const card of members) {
    for (const entity of card.entities) {
      if (normalizeTitle(entity) === normalizedTitle) return 'concepts';
    }
  }
  return 'concepts';
}

/**
 * Compute the deterministic hash of a cluster's contributing card hashes.
 * Sorting first means re-adding the same cards in a different order produces
 * the same hash — the synthesis manifest uses this to skip unchanged clusters.
 */
export function computeClusterHash(cardHashes: string[]): string {
  const sorted = [...cardHashes].sort();
  return 'sha256:' + createHash('sha256').update(sorted.join('|')).digest('hex');
}

/**
 * Group source-cards into rollup clusters.
 *
 *  1. For each card, collect candidate titles: `suggestedPages` first; if
 *     empty, fall back to `concepts`. This matches the resolved decision in
 *     specs/synthesis-pipeline.md.
 *  2. Normalize each candidate title; the normalized form is the cluster key.
 *  3. Drop clusters with fewer than `MIN_CLUSTER_SIZE` distinct contributing
 *     cards (singletons stay as `sources/*.md` only).
 *  4. Pick the display title (most common raw form among contributors) and
 *     categorize.
 *
 * The function is pure: deterministic for a given input order. The caller
 * (the orchestrator) is responsible for hashing input cards consistently.
 */
export function clusterSourceCards(
  cards: Array<{ card: SourceCard; cardHash: string; sourcePage: string }>,
  projectNames: Set<string> = new Set(),
  minClusterSize: number = MIN_CLUSTER_SIZE,
): Cluster[] {
  // normalized title → { rawTitleCounts, contributors (by cardHash, deduped) }
  const buckets = new Map<
    string,
    {
      rawTitleCounts: Map<string, number>;
      contributors: Map<string, { card: SourceCard; sourcePage: string }>;
    }
  >();

  for (const entry of cards) {
    const candidates = entry.card.suggestedPages.length
      ? entry.card.suggestedPages
      : entry.card.concepts;
    const seenForThisCard = new Set<string>();

    for (const candidate of candidates) {
      const normalized = normalizeTitle(candidate);
      if (!normalized) continue;
      if (seenForThisCard.has(normalized)) continue;
      seenForThisCard.add(normalized);

      let bucket = buckets.get(normalized);
      if (!bucket) {
        bucket = { rawTitleCounts: new Map(), contributors: new Map() };
        buckets.set(normalized, bucket);
      }
      bucket.rawTitleCounts.set(
        candidate,
        (bucket.rawTitleCounts.get(candidate) ?? 0) + 1,
      );
      if (!bucket.contributors.has(entry.cardHash)) {
        bucket.contributors.set(entry.cardHash, {
          card: entry.card,
          sourcePage: entry.sourcePage,
        });
      }
    }
  }

  const clusters: Cluster[] = [];
  for (const [normalized, bucket] of buckets) {
    if (bucket.contributors.size < minClusterSize) continue;

    const displayTitle = pickDisplayTitle(bucket.rawTitleCounts);
    const memberEntries = [...bucket.contributors.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const members: ClusterMember[] = memberEntries.map(
      ([cardHash, { sourcePage }], i) => ({
        cardHash,
        sourcePage,
        citationIndex: i + 1,
      }),
    );

    const tags = unionTags(memberEntries.map(([, m]) => m.card.tags));
    const category = categorizeCluster(
      normalized,
      memberEntries.map(([, m]) => m.card),
      projectNames,
    );

    clusters.push({
      title: displayTitle,
      slug: slugifyLabel(normalized) || slugifyLabel(displayTitle),
      category,
      members,
      tags,
      clusterHash: computeClusterHash(members.map((m) => m.cardHash)),
    });
  }

  clusters.sort((a, b) => a.slug.localeCompare(b.slug));
  return clusters;
}

function pickDisplayTitle(rawTitleCounts: Map<string, number>): string {
  let bestTitle = '';
  let bestCount = -1;
  for (const [title, count] of rawTitleCounts) {
    // Tie-break: prefer the lexicographically earlier title for determinism.
    if (count > bestCount || (count === bestCount && title < bestTitle)) {
      bestTitle = title;
      bestCount = count;
    }
  }
  return bestTitle;
}

function unionTags(tagLists: string[][]): string[] {
  const set = new Set<string>();
  for (const list of tagLists) for (const t of list) set.add(t);
  return [...set].sort();
}
