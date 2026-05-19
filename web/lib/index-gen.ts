import matter from 'gray-matter';

import { getStructure } from '@/lib/vault-structure';
import { getObject, listObjects, putObject } from '@/lib/s3';
import { isDocumentKey } from '@/lib/vault-paths';
import { inferScopeFromKey, resolveScope, type ScopePaths } from '@/lib/scope';

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

/** Regenerate a single space's index.md inside the given scope. */
export async function regenerateSpaceIndex(
  space: string,
  scope: ScopePaths = resolveScope({ scope: 'shared' }),
): Promise<void> {
  const keys = [
    ...(await listObjects(scope.generatedPrefix(space))),
    ...(await listObjects(scope.authoredPrefix(space))),
  ].filter(isDocumentKey);

  const lines: string[] = [];
  for (let i = 0; i < keys.length; i += 20) {
    const batch = keys.slice(i, i + 20);
    lines.push(...(await Promise.all(batch.map(buildLine))));
  }

  const body = `---\ntitle: ${toTitleCase(space)} Index\ntype: nav\nupdated: ${new Date().toISOString()}\n---\n\n${lines.join('\n')}\n`;
  await putObject(scope.systemKey(`indexes/${space}.md`), body);
}

/**
 * Regenerate any per-space and master indexes affected by a write to a single
 * key. Infers the scope from the key path (`users/<id>/...` → user scope; else
 * shared) and the space from the key segment after the provenance root.
 */
export async function regenerateIndexesForKey(key: string): Promise<void> {
  const scope = inferScopeFromKey(key);
  const space = spaceFromKey(key);
  if (space) await regenerateSpaceIndex(space, scope);
  await regenerateMasterIndex(scope);
}

function spaceFromKey(key: string): string | null {
  const userGenerated = key.match(/^users\/[^/]+\/generated\/([^/]+)\//);
  if (userGenerated) return userGenerated[1];
  const userAuthored = key.match(/^users\/[^/]+\/authored\/([^/]+)\//);
  if (userAuthored) return userAuthored[1];
  const sharedGenerated = key.match(/^generated\/([^/]+)\//);
  if (sharedGenerated) return sharedGenerated[1];
  const sharedAuthored = key.match(/^authored\/([^/]+)\//);
  if (sharedAuthored) return sharedAuthored[1];
  return null;
}

/**
 * Regenerate the master `index.md` for the given scope. Aggregates every
 * declared `indexed` space's content under that scope. Personal is excluded
 * from the master view.
 */
export async function regenerateMasterIndex(
  scope: ScopePaths = resolveScope({ scope: 'shared' }),
): Promise<void> {
  const structure = await getStructure();
  const spaces = structure.spaces
    .filter((s) => s.indexed)
    .map((s) => s.name)
    .filter((name) => name !== 'personal' || scope.scope === 'user');
  const sections: string[] = [];

  for (const space of spaces.sort()) {
    const keys = [
      ...(await listObjects(scope.generatedPrefix(space))),
      ...(await listObjects(scope.authoredPrefix(space))),
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
  await putObject(scope.systemKey('index.md'), body);
}
