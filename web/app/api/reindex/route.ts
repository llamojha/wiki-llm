import { NextResponse } from 'next/server';
import matter from 'gray-matter';

import { getObject, listObjects, putObject } from '@/lib/s3';
import { getStructure } from '@/lib/vault-structure';

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

  const structure = await getStructure();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      };

      try {
        // Determine which spaces to index
        let targetSpaces: string[];
        if (space) {
          targetSpaces = [space];
        } else if (structure.spaces.length > 0) {
          // Only index spaces declared in structure.json with indexed: true
          targetSpaces = structure.spaces.filter((s) => s.indexed).map((s) => s.name);
        } else {
          // No structure.json — fall back to listing all top-level prefixes
          const allKeys = await listObjects();
          const spaceSet = new Set<string>();
          for (const k of allKeys) {
            const first = k.split('/')[0];
            if (first && first !== 'raw') spaceSet.add(first);
          }
          targetSpaces = [...spaceSet];
        }

        // Gather keys per space
        const spaceKeys: { space: string; keys: string[] }[] = [];
        let rawCount = 0;
        for (const s of targetSpaces) {
          const allKeys = await listObjects(`${s}/`);
          const keys = allKeys.filter(
            (k) => !k.startsWith(`${s}/raw/`) && k !== `${s}/index.md`,
          );
          rawCount += allKeys.filter((k) => k.startsWith(`${s}/raw/`)).length;
          spaceKeys.push({ space: s, keys });
        }

        // Also count root-level raw/
        const rootRaw = await listObjects('raw/');
        rawCount += rootRaw.length;

        const total = spaceKeys.reduce((n, sk) => n + sk.keys.length, 0);
        let indexed = 0;
        send({ type: 'start', total, rawCount, spaces: targetSpaces });

        // Build per-space index.md
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
          await putObject(`${sk.space}/index.md`, indexBody);
        }

        // Master index — only include spaces from structure (or all if no structure)
        const masterSpaces = spaceKeys.filter((sk) => sk.space !== 'personal');
        const sections: string[] = [];
        for (const sk of masterSpaces.sort((a, b) => a.space.localeCompare(b.space))) {
          const lines = spaceLines.get(sk.space);
          if (!lines?.length) continue;
          const label = structure.spaces.find((s) => s.name === sk.space)?.label ?? toTitleCase(sk.space);
          sections.push(`## ${label}\n${lines.join('\n')}`);
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
