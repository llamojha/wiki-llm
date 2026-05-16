import { NextResponse } from 'next/server';
import { getObject, putObject } from '@/lib/s3';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { jobId } = body as { jobId?: string };

  if (!jobId) {
    return NextResponse.json({ detail: 'jobId is required' }, { status: 400 });
  }

  try {
    const raw = await getObject(`_jobs/${jobId}.json`);
    const job = JSON.parse(raw);
    job.status = 'cancelled';
    job.completedAt = new Date().toISOString();
    await putObject(`_jobs/${jobId}.json`, JSON.stringify(job, null, 2));
    return NextResponse.json({ cancelled: true });
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'NoSuchKey') {
      return NextResponse.json({ detail: 'job not found' }, { status: 404 });
    }
    throw err;
  }
}
