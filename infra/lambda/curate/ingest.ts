import { getObject, getObjectOrNull, putJson, putObject, listObjects } from './s3.js';
import { converse } from './bedrock.js';
import { buildExtractionSystemPrompt, buildExtractionUserPrompt } from './prompt.js';
import { getManifest, saveManifest, addToManifest, computeHash } from './manifest.js';
import {
  parseSourceCard,
  renderSourcePage,
  resolveOutputSpace,
  sourceSlug,
} from './source-card.js';

function nowMs(): number {
  return Date.now();
}

function logTiming(jobId: string | undefined, rawKey: string, stage: string, startedAt: number): void {
  const prefix = jobId ? `[${jobId}] ` : '';
  console.log(`${prefix}${rawKey} ${stage} ${Date.now() - startedAt}ms`);
}

function sourceCardKey(hash: string): string {
  return `_curation/source-cards/${hash.replace(/^sha256:/, '')}.json`;
}

export async function processSource(
  bucket: string,
  prefix: string,
  space: string,
  rawKey: string,
  jobId?: string,
): Promise<string[]> {
  // 1. Read source
  let startedAt = nowMs();
  const sourceContent = await getObject(bucket, prefix, rawKey);
  const hash = computeHash(sourceContent);
  logTiming(jobId, rawKey, 'read-source', startedAt);

  // 2. Get lightweight existing page summaries for placement hints.
  startedAt = nowMs();
  const existingKeys = await listObjects(bucket, prefix, `${space}/`);
  const summaryReads = existingKeys
    .filter(key => key.endsWith('.md') && key !== `${space}/index.md`)
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
  logTiming(jobId, rawKey, 'read-placement-hints', startedAt);

  // 3. Extract one compact source card. Index/log/global synthesis happen later.
  const system = buildExtractionSystemPrompt();
  const user = buildExtractionUserPrompt({
    space,
    rawKey,
    sourceContent,
    existingPageSummaries: summaries.join('\n'),
  });

  startedAt = nowMs();
  const response = await converse(system, user);
  logTiming(jobId, rawKey, 'bedrock-extract', startedAt);

  const card = parseSourceCard(response, rawKey);
  const outputSpace = resolveOutputSpace(space, card);
  const cardKey = sourceCardKey(hash);
  const pagePath = `${outputSpace}/sources/${sourceSlug(card, rawKey, hash)}.md`;
  const pageContent = renderSourcePage(card, rawKey, hash);

  // 4. Deterministically write the durable card and source page.
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
  startedAt = nowMs();
  const manifest = await getManifest(bucket, prefix);
  const updated = addToManifest(manifest, rawKey, hash, outputSpace, [pagePath], cardKey);
  await saveManifest(bucket, prefix, updated);
  logTiming(jobId, rawKey, 'update-manifest', startedAt);

  return [pagePath];
}
