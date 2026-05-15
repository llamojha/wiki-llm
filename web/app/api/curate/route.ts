import { NextResponse } from 'next/server';

import { runCuration } from '@/lib/ingest/run';
import { regenerateMasterIndex, regenerateSpaceIndex } from '@/lib/index-gen';
import { listObjects } from '@/lib/s3';
import { getStructure } from '@/lib/vault-structure';

const SPACE_RE = /^[a-z0-9][a-z0-9-]*$/;

async function resolveKeys(space: string, key?: string): Promise<{ keys: string[]; spaces: string[] }> {
  if (key) return { keys: [key], spaces: [space] };

  if (space === '__all') {
    const structure = await getStructure();
    const allKeys: string[] = [];
    const spaces: string[] = [];
    allKeys.push(...await listObjects('raw/'));
    if (allKeys.length > 0) spaces.push('');
    for (const s of structure.spaces) {
      const k = await listObjects(`${s.name}/raw/`);
      if (k.length > 0) { allKeys.push(...k); spaces.push(s.name); }
    }
    return { keys: allKeys, spaces };
  }

  return { keys: await listObjects(`${space}/raw/`), spaces: [space] };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { space, key, stream } = body as { space?: string; key?: string; stream?: boolean };

  if (!space) {
    return NextResponse.json({ detail: 'space is required' }, { status: 400 });
  }

  if (space !== '__all' && !SPACE_RE.test(space)) {
    return NextResponse.json(
      { detail: 'space must be lowercase alphanumeric with hyphens only' },
      { status: 400 },
    );
  }

  if (key && !key.startsWith(`${space}/raw/`)) {
    return NextResponse.json(
      { detail: `key must start with ${space}/raw/` },
      { status: 400 },
    );
  }

  const { keys, spaces } = await resolveKeys(space, key);

  if (keys.length === 0) {
    return NextResponse.json(
      { detail: `no files found in ${space === '__all' ? '' : space + '/'}raw/` },
      { status: 404 },
    );
  }

  // Non-streaming mode (backwards compat)
  if (!stream) {
    const results = [];
    for (const rawKey of keys) {
      const keySpace = space === '__all' ? rawKey.split('/')[0] === 'raw' ? '' : rawKey.split('/')[0] : space;
      try {
        const result = await runCuration(keySpace || space, rawKey);
        results.push({
          rawKey,
          pages: result.pages.map((p) => ({ key: p.key, title: p.title })),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        results.push({ rawKey, error: message });
      }
    }
    for (const s of spaces) { if (s) await regenerateSpaceIndex(s); }
    await regenerateMasterIndex();
    return NextResponse.json({ space, results });
  }

  // Streaming mode: NDJSON progress
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const total = keys.length;
      controller.enqueue(encoder.encode(JSON.stringify({ type: 'start', total }) + '\n'));

      for (let i = 0; i < keys.length; i++) {
        const rawKey = keys[i];
        const keySpace = space === '__all' ? (rawKey.split('/')[0] === 'raw' ? '' : rawKey.split('/')[0]) : space;
        try {
          const result = await runCuration(keySpace || space, rawKey);
          controller.enqueue(encoder.encode(JSON.stringify({
            type: 'progress',
            index: i + 1,
            total,
            rawKey,
            pages: result.pages.map((p) => ({ key: p.key, title: p.title })),
          }) + '\n'));
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          controller.enqueue(encoder.encode(JSON.stringify({
            type: 'progress',
            index: i + 1,
            total,
            rawKey,
            error: message,
          }) + '\n'));
        }
      }

      for (const s of spaces) { if (s) await regenerateSpaceIndex(s); }
      await regenerateMasterIndex();
      controller.enqueue(encoder.encode(JSON.stringify({ type: 'done' }) + '\n'));
      controller.close();
    },
  });

  return new Response(readable, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Transfer-Encoding': 'chunked' },
  });
}
