import { NextResponse } from 'next/server';
import { getObject, putObject } from '@/lib/s3';
import { resolveScope, type Scope } from '@/lib/scope';
import { flagGuard } from '@/lib/flags';

export async function POST(req: Request) {
  const blocked = flagGuard('curate');
  if (blocked) return blocked;

  const body = await req.json().catch(() => ({}));
  const { jobId, scope: scopeName, userId } = body as {
    jobId?: string;
    scope?: Scope;
    userId?: string;
  };

  if (!jobId) {
    return NextResponse.json({ detail: 'jobId is required' }, { status: 400 });
  }

  const scope = resolveScope({ scope: scopeName ?? 'shared', userId });

  try {
    const key = scope.systemKey(`jobs/${jobId}.json`);
    const raw = await getObject(key);
    const job = JSON.parse(raw);
    job.status = 'cancelled';
    job.completedAt = new Date().toISOString();
    await putObject(key, JSON.stringify(job, null, 2));
    return NextResponse.json({ cancelled: true });
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'NoSuchKey') {
      return NextResponse.json({ detail: 'job not found' }, { status: 404 });
    }
    throw err;
  }
}
