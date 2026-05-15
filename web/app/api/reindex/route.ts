import { NextResponse } from 'next/server';
import matter from 'gray-matter';

import { getObject, listObjects, listSpaces, putObject } from '@/lib/s3';

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
  const body = await req.json().catch(() => ({}));
  const { space } = body as { space?: string };

  if (space && !SPACE_RE.test(space)) {
    return NextResponse.json({ detail: 'invalid space name' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      };

      try {
        const spaces = space ? [space] : await listSpaces();
        // Gather all keys across spaces for total count
        const spaceKeys: { space: string; keys: string[] }[] = [];
        for (const s of spaces) {
          const allKeys = await listObjects(`${s}/`);
          const keys = allKeys.filter(
            (k) => !k.startsWith(`${s}/raw/`) && k !== `${s}/index.md`,
          );
          spaceKeys.push({ space: s, keys });
        }

        const total = spaceKeys.reduce((n, sk) => n + sk.keys.length, 0);
        let indexed = 0;
        send({ type: 'start', total, spaces: spaceKeys.map((sk) => sk.space) });

        for (const sk of spaceKeys) {
          const lines: string[] = [];
          for (const key of sk.keys) {
            lines.push(await buildLine(key));
            indexed++;
            send({ type: 'progress', space: sk.space, key, indexed, total });
          }
          const body = `---\ntitle: ${toTitleCase(sk.space)} Index\ntype: nav\nupdated: ${new Date().toISOString()}\n---\n\n${lines.join('\n')}\n`;
          await putObject(`${sk.space}/index.md`, body);
        }

        // Master index
        const masterSpaces = spaceKeys.filter((sk) => sk.space !== 'personal');
        const sections: string[] = [];
        for (const sk of masterSpaces.sort((a, b) => a.space.localeCompare(b.space))) {
          if (!sk.keys.length) continue;
          const lines: string[] = [];
          for (const key of sk.keys) {
            lines.push(await buildLine(key));
          }
          sections.push(`## ${toTitleCase(sk.space)}\n${lines.join('\n')}`);
        }
        const masterBody = `---\ntitle: Index\ntype: nav\nupdated: ${new Date().toISOString()}\n---\n\n${sections.join('\n\n')}\n`;
        await putObject('index.md', masterBody);

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
