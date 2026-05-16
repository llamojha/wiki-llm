import { getObject, getObjectOrNull, putObject, listObjects } from './s3.js';
import { converse } from './bedrock.js';
import { buildSystemPrompt, buildUserPrompt } from './prompt.js';
import { parseFileBlocks } from './parse.js';
import { getManifest, saveManifest, addToManifest, computeHash } from './manifest.js';

export async function processSource(
  bucket: string,
  prefix: string,
  space: string,
  rawKey: string,
): Promise<string[]> {
  // 1. Read source
  const sourceContent = await getObject(bucket, prefix, rawKey);

  // 2. Read wiki context
  const overviewContent = await getObjectOrNull(bucket, prefix, 'overview.md') ?? '';
  const spaceIndexContent = await getObjectOrNull(bucket, prefix, `${space}/index.md`) ?? '';
  const fullLog = await getObjectOrNull(bucket, prefix, 'log.md') ?? '';
  const recentLog = fullLog.split('\n').slice(-60).join('\n'); // last ~20 entries

  // 3. Get existing page summaries (title + first line after frontmatter)
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

  // 4. Single Bedrock call
  const system = buildSystemPrompt();
  const user = buildUserPrompt({
    space,
    rawKey,
    sourceContent,
    overviewContent,
    spaceIndexContent,
    recentLog,
    existingPageSummaries: summaries.join('\n'),
  });

  const response = await converse(system, user);

  // 5. Parse file blocks
  const blocks = parseFileBlocks(response);
  if (blocks.length === 0) {
    throw new Error('Bedrock returned no file blocks');
  }

  // 6. Write all output files
  const pages: string[] = [];
  for (const block of blocks) {
    await putObject(bucket, prefix, block.path, block.content);
    pages.push(block.path);
  }

  // 7. Update manifest
  const manifest = await getManifest(bucket, prefix);
  const hash = computeHash(sourceContent);
  const updated = addToManifest(manifest, rawKey, hash, space, pages);
  await saveManifest(bucket, prefix, updated);

  return pages;
}
