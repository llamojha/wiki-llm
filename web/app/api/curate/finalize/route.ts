import { NextResponse } from 'next/server';

import { getObject, putObject } from '@/lib/s3';
import { systemKey } from '@/lib/vault-paths';
import {
  regenerateMasterIndex,
  regenerateSpaceIndex,
} from '@/lib/index-gen';
import { invalidateSearchIndex } from '@/lib/search';

/**
 * Post-ingest finalization step.
 *
 * The curate Lambda writes generated pages to S3 but does not touch any
 * derived artifacts. This route regenerates the affected space's `index.md`,
 * the master `_system/index.md`, and invalidates the in-memory Fuse search
 * cache so the new pages become discoverable.
 *
 * Idempotent: once a job's `finalized` flag is true, subsequent calls return
 * the current job without re-running the regeneration.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { jobId } = body as { jobId?: string };

  if (!jobId) {
    return NextResponse.json({ detail: 'jobId is required' }, { status: 400 });
  }

  const key = systemKey(`jobs/${jobId}.json`);

  let job: {
    id: string;
    status: string;
    space: string;
    finalized?: boolean;
    finalizedAt?: string;
    [k: string]: unknown;
  };
  try {
    job = JSON.parse(await getObject(key));
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'NoSuchKey') {
      return NextResponse.json({ detail: 'job not found' }, { status: 404 });
    }
    throw err;
  }

  if (job.status !== 'done') {
    return NextResponse.json(
      { detail: `job is not done (status=${job.status})` },
      { status: 409 },
    );
  }

  if (job.finalized) {
    return NextResponse.json(job);
  }

  await regenerateSpaceIndex(job.space);
  await regenerateMasterIndex();
  invalidateSearchIndex();

  const updated = {
    ...job,
    finalized: true,
    finalizedAt: new Date().toISOString(),
  };
  await putObject(key, JSON.stringify(updated, null, 2));

  return NextResponse.json(updated);
}
