import { getObjectOrNull, putJson } from './s3.js';
import type { ScopePaths } from './scope.js';
import type { Cluster } from './cluster.js';

/**
 * Idempotency manifest for the synthesis pass.
 * See specs/synthesis-pipeline.md — implements task #6.
 *
 * Keyed by `<category>/<slug>` (the rollup page's path within the space's
 * generated prefix). Storing `clusterHash` lets the orchestrator skip
 * Bedrock calls for unchanged clusters and detect when a cluster has lost
 * enough members to drop below MIN_CLUSTER_SIZE.
 */

export type SynthesisManifestEntry = {
  clusterHash: string;
  contributingCards: string[];
  pagePath: string;
  synthesizedAt: string;
};

export type SynthesisManifest = {
  clusters: Record<string, SynthesisManifestEntry>;
};

function manifestKey(scope: ScopePaths): string {
  return scope.systemKey('synthesis-manifest.json');
}

export async function getSynthesisManifest(
  bucket: string,
  prefix: string,
  scope: ScopePaths,
): Promise<SynthesisManifest> {
  const raw = await getObjectOrNull(bucket, prefix, manifestKey(scope));
  if (!raw) return { clusters: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<SynthesisManifest>;
    return { clusters: parsed.clusters ?? {} };
  } catch {
    // Corrupt manifest — treat as empty rather than blocking the run.
    // The next save will overwrite it with a valid one.
    return { clusters: {} };
  }
}

export async function saveSynthesisManifest(
  bucket: string,
  prefix: string,
  scope: ScopePaths,
  manifest: SynthesisManifest,
): Promise<void> {
  await putJson(bucket, prefix, manifestKey(scope), manifest);
}

export function clusterManifestKey(cluster: Cluster): string {
  return `${cluster.category}/${cluster.slug}`;
}

export function upsertCluster(
  manifest: SynthesisManifest,
  cluster: Cluster,
  pagePath: string,
): SynthesisManifest {
  return {
    clusters: {
      ...manifest.clusters,
      [clusterManifestKey(cluster)]: {
        clusterHash: cluster.clusterHash,
        contributingCards: cluster.members.map((m) => m.cardHash),
        pagePath,
        synthesizedAt: new Date().toISOString(),
      },
    },
  };
}

/**
 * True iff the cluster has changed since it was last synthesized — i.e. its
 * hash differs from the manifest entry, or no entry exists yet. Used by the
 * orchestrator to skip unchanged clusters without paying Bedrock cost.
 */
export function clusterNeedsSynthesis(
  manifest: SynthesisManifest,
  cluster: Cluster,
): boolean {
  const entry = manifest.clusters[clusterManifestKey(cluster)];
  if (!entry) return true;
  return entry.clusterHash !== cluster.clusterHash;
}
