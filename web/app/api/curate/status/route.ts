import { NextResponse } from 'next/server';
import { getObject, headObject } from '@/lib/s3';
import { systemKey } from '@/lib/vault-paths';

const STALE_AFTER_MS = 3 * 60 * 1000;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('job');

  if (!jobId) {
    return NextResponse.json({ detail: 'job query param required' }, { status: 400 });
  }

  try {
    const key = systemKey(`jobs/${jobId}.json`);
    const [raw, meta] = await Promise.all([
      getObject(key),
      headObject(key),
    ]);
    const job = JSON.parse(raw);
    if (job.status === 'processing' && meta.lastModified) {
      const ageMs = Date.now() - meta.lastModified.getTime();
      if (ageMs > STALE_AFTER_MS) {
        return NextResponse.json({
          ...job,
          status: 'stale',
          staleAfterMs: STALE_AFTER_MS,
          lastUpdatedAt: meta.lastModified.toISOString(),
        });
      }
    }
    return NextResponse.json(job);
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'NoSuchKey') {
      return NextResponse.json({ detail: 'job not found' }, { status: 404 });
    }
    throw err;
  }
}
