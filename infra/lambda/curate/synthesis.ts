import { converse } from './bedrock.js';
import {
  MAX_CLUSTERS_PER_RUN,
  MIN_CLUSTER_SIZE,
  clusterSourceCards,
  type Cluster,
} from './cluster.js';
import { getObject, listObjects, putObject } from './s3.js';
import type { ScopePaths } from './scope.js';
import type { SourceCard } from './types.js';
import {
  buildSynthesisSystemPrompt,
  buildSynthesisUserPrompt,
  renderRollupPage,
  rollupPageKey,
} from './synthesis-prompt.js';
import {
  clusterNeedsSynthesis,
  getSynthesisManifest,
  saveSynthesisManifest,
  upsertCluster,
} from './synthesis-manifest.js';

/**
 * Orchestrator for the synthesis pass.
 * See specs/synthesis-pipeline.md — implements task #1.
 *
 * Loads every source-card under the scope's `_system/source-cards/` prefix,
 * clusters them, and for each cluster whose contributors have changed since
 * the last run, calls Bedrock once to produce a rollup page and writes it to
 * `generated/<space>/<category>/<slug>.md`. The synthesis manifest is saved
 * after each successful page write so a mid-run crash doesn't lose work.
 */

export type SynthesisStats = {
  cardsLoaded: number;
  clustersFound: number;
  clustersSynthesized: number;
  clustersSkippedUnchanged: number;
  clustersErrored: number;
  cappedAtMax: boolean;
};

type LoadedCard = {
  card: SourceCard;
  cardHash: string;
  sourcePage: string;
  space: string;
};

export async function runSynthesis(
  bucket: string,
  prefix: string,
  scope: ScopePaths,
  space: string,
  jobId?: string,
): Promise<SynthesisStats> {
  const tag = `[${jobId ?? 'synthesize'}]`;
  console.log(`${tag} starting synthesis scope=${scope.scope}${scope.userId ? `:${scope.userId}` : ''} space=${space}`);

  const allCards = await loadSourceCards(bucket, prefix, scope, tag);
  const cardsForSpace = allCards.filter((c) => c.space === space);
  console.log(`${tag} loaded ${allCards.length} source-cards (${cardsForSpace.length} in space=${space})`);

  const clusters = clusterSourceCards(
    cardsForSpace.map((c) => ({
      card: c.card,
      cardHash: c.cardHash,
      sourcePage: c.sourcePage,
    })),
    // projectNames: empty for now — structure.json doesn't declare projects.
    // The categorizer will default to concepts/features heuristically.
    new Set<string>(),
    MIN_CLUSTER_SIZE,
  );

  const stats: SynthesisStats = {
    cardsLoaded: cardsForSpace.length,
    clustersFound: clusters.length,
    clustersSynthesized: 0,
    clustersSkippedUnchanged: 0,
    clustersErrored: 0,
    cappedAtMax: false,
  };

  if (clusters.length === 0) {
    console.log(`${tag} no clusters reached MIN_CLUSTER_SIZE=${MIN_CLUSTER_SIZE} — nothing to synthesize`);
    return stats;
  }

  if (clusters.length > MAX_CLUSTERS_PER_RUN) {
    console.warn(
      `${tag} clustering produced ${clusters.length} clusters, capping at MAX_CLUSTERS_PER_RUN=${MAX_CLUSTERS_PER_RUN}. Investigate suggestedPages fragmentation.`,
    );
    clusters.length = MAX_CLUSTERS_PER_RUN;
    stats.cappedAtMax = true;
  }

  const cardsByHash = new Map<string, SourceCard>();
  for (const c of cardsForSpace) cardsByHash.set(c.cardHash, c.card);

  let manifest = await getSynthesisManifest(bucket, prefix, scope);

  const generatedPrefix = scope.generatedPrefix(space);
  for (const cluster of clusters) {
    if (!clusterNeedsSynthesis(manifest, cluster)) {
      stats.clustersSkippedUnchanged++;
      continue;
    }

    const pagePath = rollupPageKey(generatedPrefix, cluster);
    try {
      const body = await converse(
        buildSynthesisSystemPrompt(),
        buildSynthesisUserPrompt(cluster, cardsByHash),
      );
      const page = renderRollupPage(cluster, body);
      await putObject(bucket, prefix, pagePath, page);
      manifest = upsertCluster(manifest, cluster, pagePath);
      await saveSynthesisManifest(bucket, prefix, scope, manifest);
      stats.clustersSynthesized++;
      console.log(`${tag} synthesized ${cluster.category}/${cluster.slug} (${cluster.members.length} sources)`);
    } catch (err) {
      stats.clustersErrored++;
      const detail = err instanceof Error ? err.message : 'synthesis call failed';
      console.error(`${tag} synthesis failed for ${cluster.category}/${cluster.slug}: ${detail}`);
      // Continue with remaining clusters — one bad cluster shouldn't block the rest.
    }
  }

  console.log(
    `${tag} synthesis done: ${stats.clustersSynthesized} written, ${stats.clustersSkippedUnchanged} unchanged, ${stats.clustersErrored} errored (of ${stats.clustersFound} clusters)`,
  );
  return stats;
}

/**
 * List and parse every source-card under the scope's `_system/source-cards/`
 * prefix. Cards missing the augmented fields written by `ingest.ts`
 * (`hash`, `space`, `sourcePage`) are skipped — they're either legacy cards
 * or corrupt, neither of which we can safely cluster.
 */
async function loadSourceCards(
  bucket: string,
  prefix: string,
  scope: ScopePaths,
  tag: string,
): Promise<LoadedCard[]> {
  const cardsPrefix = scope.systemKey('source-cards/');
  const keys = await listObjects(bucket, prefix, cardsPrefix);
  const out: LoadedCard[] = [];
  for (const key of keys) {
    if (!key.endsWith('.json')) continue;
    try {
      const raw = await getObject(bucket, prefix, key);
      const parsed = JSON.parse(raw) as Partial<SourceCard> & {
        hash?: string;
        space?: string;
        sourcePage?: string;
      };
      if (!parsed.hash || !parsed.space || !parsed.sourcePage) {
        console.warn(`${tag} skipping card ${key} (missing hash/space/sourcePage)`);
        continue;
      }
      // Coerce the SourceCard shape — extraction guarantees these fields, but
      // we defensively default missing arrays.
      const card: SourceCard = {
        rawKey: parsed.rawKey ?? '',
        title: parsed.title ?? '',
        summary: parsed.summary ?? '',
        claims: parsed.claims ?? [],
        entities: parsed.entities ?? [],
        concepts: parsed.concepts ?? [],
        suggestedSpaces: parsed.suggestedSpaces ?? [],
        suggestedPages: parsed.suggestedPages ?? [],
        tags: parsed.tags ?? [],
      };
      out.push({
        card,
        cardHash: parsed.hash,
        sourcePage: parsed.sourcePage,
        space: parsed.space,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'parse failed';
      console.warn(`${tag} skipping card ${key}: ${detail}`);
    }
  }
  return out;
}

// Re-export so the Lambda handler can read the constant without touching cluster.ts.
export { MIN_CLUSTER_SIZE, MAX_CLUSTERS_PER_RUN } from './cluster.js';
export type { Cluster };
