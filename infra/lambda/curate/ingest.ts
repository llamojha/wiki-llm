import { getObject, getObjectOrNull, putJson, putObject, listObjects } from './s3.js';
import { converse } from './bedrock.js';
import { buildExtractionSystemPrompt, buildExtractionUserPrompt } from './prompt.js';
import { getManifest, saveManifest, addToManifest, computeHash } from './manifest.js';
import { getGeneratedSpace } from './structure.js';
import {
  parseSourceCard,
  renderSourcePage,
  spaceFromRawKey,
  sourceSlug,
} from './source-card.js';
import { generatedPrefix, systemKey } from './paths.js';
import type { FileStage } from './types.js';

export type StageReporter = (stage: FileStage) => Promise<void>;

function nowMs(): number {
  return Date.now();
}

function logTiming(jobId: string | undefined, rawKey: string, stage: string, startedAt: number): void {
  const prefix = jobId ? `[${jobId}] ` : '';
  console.log(`${prefix}${rawKey} ${stage} ${Date.now() - startedAt}ms`);
}

function sourceCardKey(hash: string): string {
  return systemKey(`source-cards/${hash.replace(/^sha256:/, '')}.json`);
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
  ingestSpace: string,
): Promise<string[]> {
  const generatedRoot = generatedPrefix(ingestSpace);
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
  jobId?: string,
  onStage?: StageReporter,
): Promise<string[]> {
  // 1. Read source
  await onStage?.('reading');
  let startedAt = nowMs();
  const sourceContent = await getObject(bucket, prefix, rawKey);
  const hash = computeHash(sourceContent);
  logTiming(jobId, rawKey, 'read-source', startedAt);

  const ingestSpace = await getGeneratedSpace(bucket, prefix);

  // 2. Extract one compact source card. Index/log/global synthesis happen later.
  const system = buildExtractionSystemPrompt();
  const user = buildExtractionUserPrompt({
    space: ingestSpace,
    rawKey,
    sourceContent,
    existingPageSummaries: hints.join('\n'),
  });

  await onStage?.('extracting');
  startedAt = nowMs();
  const response = await converse(system, user);
  logTiming(jobId, rawKey, 'bedrock-extract', startedAt);

  const card = parseSourceCard(response, rawKey);
  const sourceSpace = spaceFromRawKey(rawKey);
  if (sourceSpace && sourceSpace !== ingestSpace) {
    console.warn(`[${jobId ?? 'curate'}] ${rawKey} is scoped to ${sourceSpace}, but generated output is forced to ${ingestSpace}`);
  }
  const outputSpace = ingestSpace;
  const cardKey = sourceCardKey(hash);
  const pagePath = `${generatedPrefix(outputSpace)}sources/${sourceSlug(card, rawKey, hash)}.md`;
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
  await onStage?.('manifest');
  startedAt = nowMs();
  const manifest = await getManifest(bucket, prefix);
  const updated = addToManifest(manifest, rawKey, hash, outputSpace, [pagePath], cardKey);
  await saveManifest(bucket, prefix, updated);
  logTiming(jobId, rawKey, 'update-manifest', startedAt);

  return [pagePath];
}
