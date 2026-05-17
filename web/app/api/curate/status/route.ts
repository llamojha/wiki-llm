import { NextResponse } from 'next/server';
import { getObject, headObject } from '@/lib/s3';
import { systemKey } from '@/lib/vault-paths';

// Lambda writes per-stage heartbeats every few seconds, so the job JSON's
// LastModified should advance well within this window during real work.
const STALE_AFTER_MS = 90 * 1000;
// While the Lambda is mid-handoff (`phase: 'chaining'`), LastModified can
// freeze across the new invocation's cold start. Use a more generous window.
const STALE_AFTER_MS_CHAINING = 5 * 60 * 1000;

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
      const threshold = job.phase === 'chaining' ? STALE_AFTER_MS_CHAINING : STALE_AFTER_MS;
      if (ageMs > threshold) {
        return NextResponse.json({
          ...job,
          status: 'stale',
          staleAfterMs: threshold,
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
