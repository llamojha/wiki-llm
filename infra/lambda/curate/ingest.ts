import { getObject, getObjectOrNull, putJson, putObject, listObjects } from './s3.js';
import { converse } from './bedrock.js';
import { buildExtractionSystemPrompt, buildExtractionUserPrompt } from './prompt.js';
import { getManifest, saveManifest, addToManifest, computeHash } from './manifest.js';
import { placementFromRawKey, sourcePageKey } from './paths.js';
import {
  parseSourceCard,
  renderSourcePage,
  sourceSlug,
} from './source-card.js';
import type { ScopePaths } from './scope.js';
import type { FileStage } from './types.js';

export type StageReporter = (stage: FileStage) => Promise<void>;
export type WriteQueue = <T>(fn: () => Promise<T>) => Promise<T>;

function nowMs(): number {
  return Date.now();
}

function logTiming(jobId: string | undefined, rawKey: string, stage: string, startedAt: number): void {
  const prefix = jobId ? `[${jobId}] ` : '';
  console.log(`${prefix}${rawKey} ${stage} ${Date.now() - startedAt}ms`);
}

function sourceCardKey(scope: ScopePaths, hash: string): string {
  return scope.systemKey(`source-cards/${hash.replace(/^sha256:/, '')}.json`);
}

/**
 * Read up to 50 lightweight summaries of existing pages in the generated space.
 *
 * Loop-invariant across a batch — call this **once per Lambda invocation**, not
 * once per file. Re-reading 50 full Markdown bodies for every input file was the
 * dominant cost in the previous design (see postmortem 2026-05-17).
 */
export async function loadPlacementHints(
  bucket: string,
  prefix: string,
  scope: ScopePaths,
  ingestSpace: string,
): Promise<string[]> {
  const generatedRoot = scope.generatedPrefix(ingestSpace);
  const existingKeys = await listObjects(bucket, prefix, generatedRoot);
  const summaryReads = existingKeys
    .filter(key => key.endsWith('.md'))
    .slice(0, 50);
  const summaryContents = await Promise.all(
    summaryReads.map(key => getObjectOrNull(bucket, prefix, key).then(c => ({ key, content: c })))
  );
  const summaries: string[] = [];
  for (const { key, content } of summaryContents) {
    if (!content) continue;
    const lines = content.split('\n');
    let startIdx = 0;
    if (lines[0]?.trim() === '---') {
      const endIdx = lines.indexOf('---', 1);
      if (endIdx > 0) startIdx = endIdx + 1;
    }
    const firstLine = lines.slice(startIdx).find(l => l.trim());
    summaries.push(`- ${key}: ${firstLine?.slice(0, 80) ?? ''}`);
  }
  return summaries;
}

export async function processSource(
  bucket: string,
  prefix: string,
  _space: string,
  rawKey: string,
  hints: string[],
  scope: ScopePaths,
  /**
   * Allowed generated spaces, in priority order. The first entry is the
   * fallback used when the source card's `suggestedSpaces` is empty or
   * names nothing in this list.
   *
   * Required: without it, every file lands in the same space regardless of
   * what the LLM suggested (see the 2026-05-31 backup-bucket reprocess).
   */
  generatedSpaces: string[],
  jobId?: string,
  onStage?: StageReporter,
  /**
   * Serializes the manifest's read-modify-write step. Required when callers
   * run `processSource` concurrently (e.g. `CURATE_CONCURRENCY > 1`) —
   * otherwise concurrent workers each read the same baseline
   * `processed.json`, merge their own file in, and the last writer wins,
   * silently dropping the other workers' manifest entries.
   *
   * When omitted (single-threaded callers, tests), manifest writes happen
   * inline.
   */
  enqueueManifestWrite?: WriteQueue,
): Promise<string[]> {
  // 1. Read source
  await onStage?.('reading');
  let startedAt = nowMs();
  const sourceContent = await getObject(bucket, prefix, rawKey);
  const hash = computeHash(sourceContent);
  logTiming(jobId, rawKey, 'read-source', startedAt);

  if (generatedSpaces.length === 0) {
    throw new Error('processSource called with empty generatedSpaces — caller must supply at least one fallback');
  }
  const defaultSpace = generatedSpaces[0];

  // 2. Extract one compact source card. Index/log/global synthesis happen later.
  const system = buildExtractionSystemPrompt();
  const user = buildExtractionUserPrompt({
    space: defaultSpace,
    allowedSpaces: generatedSpaces,
    rawKey,
    sourceContent,
    existingPageSummaries: hints.join('\n'),
  });

  await onStage?.('extracting');
  startedAt = nowMs();
  const response = await converse(system, user);
  logTiming(jobId, rawKey, 'bedrock-extract', startedAt);

  const parsedCard = parseSourceCard(response, rawKey);
  const allowed = new Set(generatedSpaces);
  const suggested = parsedCard.suggestedSpaces.find((s) => allowed.has(s));
  const outputSpace = suggested ?? defaultSpace;
  if (!suggested && parsedCard.suggestedSpaces.length > 0) {
    console.warn(`[${jobId ?? 'curate'}] ${rawKey} suggestedSpaces=[${parsedCard.suggestedSpaces.join(',')}] not in allowed=[${generatedSpaces.join(',')}] — falling back to ${defaultSpace}`);
  }
  // Placement (sub-folder under sources/) is derived deterministically from rawKey —
  // mirrors raw/ layout, keeps page URLs stable across re-extractions. See specs/sources-foldering.md.
  const placement = placementFromRawKey(rawKey);
  const card = { ...parsedCard, placement };
  const cardKey = sourceCardKey(scope, hash);
  const pagePath = sourcePageKey(scope.generatedPrefix(outputSpace), placement, sourceSlug(card, rawKey, hash));
  const pageContent = renderSourcePage(card, rawKey, hash);

  // 4. Deterministically write the durable card and source page.
  await onStage?.('writing');
  startedAt = nowMs();
  await putJson(bucket, prefix, cardKey, {
    ...card,
    hash,
    space: outputSpace,
    sourcePage: pagePath,
    extractedAt: new Date().toISOString(),
  });
  await putObject(bucket, prefix, pagePath, pageContent);
  logTiming(jobId, rawKey, 'write-source-card-and-page', startedAt);

  // 5. Update manifest. Final index/log/lint is a separate maintenance pass.
  // Serialized via enqueueManifestWrite so concurrent workers don't clobber
  // each other's entries (see param doc).
  await onStage?.('manifest');
  startedAt = nowMs();
  const writeManifest = async () => {
    const manifest = await getManifest(bucket, prefix, scope);
    const updated = addToManifest(manifest, rawKey, hash, outputSpace, [pagePath], cardKey);
    await saveManifest(bucket, prefix, scope, updated);
  };
  if (enqueueManifestWrite) {
    await enqueueManifestWrite(writeManifest);
  } else {
    await writeManifest();
  }
  logTiming(jobId, rawKey, 'update-manifest', startedAt);

  return [pagePath];
}
