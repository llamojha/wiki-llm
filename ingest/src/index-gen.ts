import matter from 'gray-matter';

import { getObject, listObjects, putObject } from './s3.js';

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
    ...(await listObjects(`generated/${space}/`)),
    ...(await listObjects(`authored/${space}/`)),
  ].filter(isDocumentKey);

  const lines: string[] = [];
  for (let i = 0; i < keys.length; i += 20) {
    const batch = keys.slice(i, i + 20);
    lines.push(...(await Promise.all(batch.map(buildLine))));
  }

  const body = `---\ntitle: ${toTitleCase(space)} Index\ntype: nav\nupdated: ${new Date().toISOString()}\n---\n\n${lines.join('\n')}\n`;
  await putObject(`_system/indexes/${space}.md`, body);
}

/** Regenerate the master index.md (aggregates all shared spaces, excludes personal). */
export async function regenerateMasterIndex(): Promise<void> {
  const spaces = await configuredSpaces();
  const sections: string[] = [];

  for (const space of spaces.sort()) {
    const keys = [
      ...(await listObjects(`generated/${space}/`)),
      ...(await listObjects(`authored/${space}/`)),
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
  await putObject('_system/index.md', body);
}

function isDocumentKey(key: string): boolean {
  if (!key.endsWith('.md')) return false;
  const filename = key.split('/').pop()!;
  return filename !== 'index.md' && filename !== 'log.md' && !filename.match(/^log-.*\.md$/);
}

async function configuredSpaces(): Promise<string[]> {
  try {
    const raw = await getObject('_system/structure.json');
    const structure = JSON.parse(raw) as { spaces?: Array<{ name: string; indexed?: boolean }> };
    const spaces = structure.spaces?.filter((space) => space.indexed !== false).map((space) => space.name) ?? [];
    if (spaces.length) return spaces.filter((space) => space !== 'personal');
  } catch {
    // Fall back to the default MVP ingest space.
  }
  return ['wiki'];
}
