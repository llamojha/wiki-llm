import { NextResponse } from 'next/server';
import { getObject } from '@/lib/s3';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('job');

  if (!jobId) {
    return NextResponse.json({ detail: 'job query param required' }, { status: 400 });
  }

  try {
    const raw = await getObject(`_jobs/${jobId}.json`);
    const job = JSON.parse(raw);
    return NextResponse.json(job);
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'NoSuchKey') {
      return NextResponse.json({ detail: 'job not found' }, { status: 404 });
    }
    throw err;
  }
}
