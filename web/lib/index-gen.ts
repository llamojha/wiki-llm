import matter from 'gray-matter';

import { getObject, listObjects, putObject } from '@/lib/s3';

function toTitleCase(str: string): string {
  return str.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractSummary(content: string): string {
  return content
    .replace(/[#*_`>\[\]()!~|]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 80);
}

/**
 * Regenerate index.md from all docs in the vault.
 *
 * Known limitation: O(n) — reads every doc on every create/delete.
 * At 200 docs this adds ~2-3s latency. Acceptable for MVP.
 * Future optimization: incremental index updates (add/remove single entries).
 */
export async function regenerateIndex(): Promise<void> {
  const keys = (await listObjects()).filter(
    (k) => k !== 'index.md' && k !== 'log.md',
  );

  const lines: string[] = [];
  const BATCH = 20;

  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (key) => {
        try {
          const raw = await getObject(key);
          const { data, content } = matter(raw);
          const title =
            (data.title as string) ||
            toTitleCase(key.replace(/^.*\//, '').replace(/\.md$/, ''));
          const summary = extractSummary(content);
          return `- ${key} — ${title} — ${summary}`;
        } catch {
          const title = toTitleCase(key.replace(/^.*\//, '').replace(/\.md$/, ''));
          return `- ${key} — ${title} —`;
        }
      }),
    );
    lines.push(...results);
  }

  const indexContent = `---\ntitle: Index\ntype: nav\nupdated: ${new Date().toISOString()}\n---\n\n${lines.join('\n')}\n`;
  await putObject('index.md', indexContent);
}
