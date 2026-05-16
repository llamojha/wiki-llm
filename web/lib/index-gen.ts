import matter from 'gray-matter';

import { getStructure } from '@/lib/vault-structure';
import { getObject, listObjects, putObject } from '@/lib/s3';
import {
  authoredSpaceFromKey,
  authoredPrefix,
  generatedSpaceFromKey,
  generatedPrefix,
  isDocumentKey,
  systemKey,
  USERS_ROOT,
} from '@/lib/vault-paths';

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

async function buildLine(key: string): Promise<string> {
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
}

/** Regenerate a single space's index.md. */
export async function regenerateSpaceIndex(space: string): Promise<void> {
  const keys = [
    ...(await listObjects(generatedPrefix(space))),
    ...(await listObjects(authoredPrefix(space))),
  ].filter(isDocumentKey);

  const lines: string[] = [];
  for (let i = 0; i < keys.length; i += 20) {
    const batch = keys.slice(i, i + 20);
    lines.push(...(await Promise.all(batch.map(buildLine))));
  }

  const body = `---\ntitle: ${toTitleCase(space)} Index\ntype: nav\nupdated: ${new Date().toISOString()}\n---\n\n${lines.join('\n')}\n`;
  await putObject(systemKey(`indexes/${space}.md`), body);
}

function indexSpaceFromKey(key: string): string | null {
  if (key.startsWith(`${USERS_ROOT}/`)) return null;
  return generatedSpaceFromKey(key) ?? authoredSpaceFromKey(key);
}

export async function regenerateIndexesForKey(key: string): Promise<void> {
  const space = indexSpaceFromKey(key);
  if (space) await regenerateSpaceIndex(space);
  await regenerateMasterIndex();
}

/** Regenerate the master index.md (aggregates all shared spaces, excludes personal). */
export async function regenerateMasterIndex(): Promise<void> {
  const structure = await getStructure();
  const spaces = structure.spaces.filter((s) => s.indexed).map((s) => s.name);
  const sections: string[] = [];

  for (const space of spaces.sort()) {
    const keys = [
      ...(await listObjects(generatedPrefix(space))),
      ...(await listObjects(authoredPrefix(space))),
    ].filter(isDocumentKey);
    if (!keys.length) continue;

    const lines: string[] = [];
    for (let i = 0; i < keys.length; i += 20) {
      const batch = keys.slice(i, i + 20);
      lines.push(...(await Promise.all(batch.map(buildLine))));
    }
    sections.push(`## ${toTitleCase(space)}\n${lines.join('\n')}`);
  }

  const body = `---\ntitle: Index\ntype: nav\nupdated: ${new Date().toISOString()}\n---\n\n${sections.join('\n\n')}\n`;
  await putObject(systemKey('index.md'), body);
}
