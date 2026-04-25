import { NextResponse } from 'next/server';
import matter from 'gray-matter';

import { getObject, listObjects, putObject } from '@/lib/s3';
import { getStructure } from '@/lib/vault-structure';
import { isDocumentKey } from '@/lib/vault-paths';
import { resolveScope, type Scope } from '@/lib/scope';
import { invalidateSearchIndex } from '@/lib/search';
import { flagGuard } from '@/lib/flags';

const SPACE_RE = /^[a-z0-9][a-z0-9-]*$/;

function toTitleCase(str: string): string {
  return str.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractSummary(content: string): string {
  return content.replace(/[#*_`>\[\]()!~|]/g, '').replace(/\n+/g, ' ').trim().slice(0, 80);
}

async function buildLine(key: string): Promise<string> {
  try {
    const raw = await getObject(key);
    const { data, content } = matter(raw);
    const title = (data.title as string) || toTitleCase(key.replace(/^.*\//, '').replace(/\.md$/, ''));
    return `- ${key} — ${title} — ${extractSummary(content)}`;
  } catch {
    return `- ${key} — ${toTitleCase(key.replace(/^.*\//, '').replace(/\.md$/, ''))} —`;
  }
}

export async function POST(req: Request) {
  const blocked = flagGuard('reindex');
  if (blocked) return blocked;

  const body = await req.json().catch(() => ({}));
  const { space, scope: scopeName, userId } = body as {
    space?: string;
    scope?: Scope;
    userId?: string;
  };

  if (space && !SPACE_RE.test(space)) {
    return NextResponse.json({ detail: 'invalid space name' }, { status: 400 });
  }

  const scope = resolveScope({ scope: scopeName ?? 'shared', userId });
  const structure = await getStructure();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      };

      try {
        // Determine which logical spaces to index for this scope.
        let targetSpaces: string[];
        if (space) {
          targetSpaces = [space];
        } else if (structure.spaces.length > 0) {
          targetSpaces = structure.spaces.filter((s) => s.indexed).map((s) => s.name);
          if (scope.scope === 'user' && !targetSpaces.includes('personal')) {
            targetSpaces.push('personal');
          }
        } else {
          targetSpaces = [];
        }

        // Gather keys per space, scoped.
        const spaceKeys: { space: string; keys: string[] }[] = [];
        for (const s of targetSpaces) {
          const keys = [
            ...(await listObjects(scope.generatedPrefix(s))),
            ...(await listObjects(scope.authoredPrefix(s))),
          ].filter(isDocumentKey);
          spaceKeys.push({ space: s, keys });
        }

        // Count scope's raw inputs that have not yet been processed.
        const rawList = await listObjects(scope.rawPrefix);
        const rawCount = rawList.length;

        const total = spaceKeys.reduce((n, sk) => n + sk.keys.length, 0);
        let indexed = 0;
        send({ type: 'start', total, rawCount, spaces: targetSpaces, scope: scope.scope, userId: scope.userId });

        const spaceLines: Map<string, string[]> = new Map();
        for (const sk of spaceKeys) {
          const lines: string[] = [];
          for (const key of sk.keys) {
            lines.push(await buildLine(key));
            indexed++;
            send({ type: 'progress', space: sk.space, key, indexed, total });
          }
          spaceLines.set(sk.space, lines);
          const indexBody = `---\ntitle: ${toTitleCase(sk.space)} Index\ntype: nav\nupdated: ${new Date().toISOString()}\n---\n\n${lines.join('\n')}\n`;
          await putObject(scope.systemKey(`indexes/${sk.space}.md`), indexBody);
        }

        // Master index — shared excludes personal, user scope includes everything.
        const masterSpaces = scope.scope === 'shared'
          ? spaceKeys.filter((sk) => sk.space !== 'personal')
          : spaceKeys;
        const sections: string[] = [];
        for (const sk of masterSpaces.sort((a, b) => a.space.localeCompare(b.space))) {
          const lines = spaceLines.get(sk.space);
          if (!lines?.length) continue;
          const label = structure.spaces.find((s) => s.name === sk.space)?.label ?? toTitleCase(sk.space);
          sections.push(`## ${label}\n${lines.join('\n')}`);
        }
        const masterBody = `---\ntitle: Index\ntype: nav\nupdated: ${new Date().toISOString()}\n---\n\n${sections.join('\n\n')}\n`;
        await putObject(scope.systemKey('index.md'), masterBody);

        invalidateSearchIndex();

        send({ type: 'done', indexed });
      } catch (err) {
        send({ type: 'error', detail: err instanceof Error ? err.message : 'Unknown error' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Transfer-Encoding': 'chunked' },
  });
}
