import { NextResponse } from 'next/server';

import { runCuration } from '@/lib/ingest/run';
import { regenerateMasterIndex, regenerateSpaceIndex } from '@/lib/index-gen';
import { listObjects } from '@/lib/s3';

const SPACE_RE = /^[a-z0-9][a-z0-9-]*$/;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { space, key, stream } = body as { space?: string; key?: string; stream?: boolean };

  if (!space) {
    return NextResponse.json({ detail: 'space is required' }, { status: 400 });
  }

  if (!SPACE_RE.test(space)) {
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

  const keys = key ? [key] : await listObjects(`${space}/raw/`);

  if (keys.length === 0) {
    return NextResponse.json(
      { detail: `no files found in ${space}/raw/` },
      { status: 404 },
    );
  }

  // Non-streaming mode (backwards compat)
  if (!stream) {
    const results = [];
    for (const rawKey of keys) {
      try {
        const result = await runCuration(space, rawKey);
        results.push({
          rawKey,
          pages: result.pages.map((p) => ({ key: p.key, title: p.title })),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        results.push({ rawKey, error: message });
      }
    }
    await regenerateSpaceIndex(space);
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
        try {
          const result = await runCuration(space, rawKey);
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

      await regenerateSpaceIndex(space);
      await regenerateMasterIndex();
      controller.enqueue(encoder.encode(JSON.stringify({ type: 'done' }) + '\n'));
      controller.close();
    },
  });

  return new Response(readable, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Transfer-Encoding': 'chunked' },
  });
}
