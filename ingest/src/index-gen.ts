import matter from 'gray-matter';

import { getObject, listObjects, listSpaces, putObject } from './s3.js';

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
  const allKeys = await listObjects(`${space}/`);
  const keys = allKeys.filter(
    (k) => !k.startsWith(`${space}/raw/`) && k !== `${space}/index.md`,
  );

  const lines: string[] = [];
  for (let i = 0; i < keys.length; i += 20) {
    const batch = keys.slice(i, i + 20);
    lines.push(...(await Promise.all(batch.map(buildLine))));
  }

  const body = `---\ntitle: ${toTitleCase(space)} Index\ntype: nav\nupdated: ${new Date().toISOString()}\n---\n\n${lines.join('\n')}\n`;
  await putObject(`${space}/index.md`, body);
}

/** Regenerate the master index.md (aggregates all shared spaces, excludes personal). */
export async function regenerateMasterIndex(): Promise<void> {
  const spaces = (await listSpaces()).filter((s) => s !== 'personal');
  const sections: string[] = [];

  for (const space of spaces.sort()) {
    const allKeys = await listObjects(`${space}/`);
    const keys = allKeys.filter(
      (k) => !k.startsWith(`${space}/raw/`) && k !== `${space}/index.md`,
    );
    if (!keys.length) continue;

    const lines: string[] = [];
    for (let i = 0; i < keys.length; i += 20) {
      const batch = keys.slice(i, i + 20);
      lines.push(...(await Promise.all(batch.map(buildLine))));
    }
    sections.push(`## ${toTitleCase(space)}\n${lines.join('\n')}`);
  }

  const body = `---\ntitle: Index\ntype: nav\nupdated: ${new Date().toISOString()}\n---\n\n${sections.join('\n\n')}\n`;
  await putObject('index.md', body);
}
