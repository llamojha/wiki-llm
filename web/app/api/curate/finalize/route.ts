import { NextResponse } from 'next/server';

import { getObject, putObject } from '@/lib/s3';
import {
  regenerateMasterIndex,
  regenerateSpaceIndex,
} from '@/lib/index-gen';
import { invalidateSearchIndex } from '@/lib/search';
import { type Scope } from '@/lib/scope';
import { resolveScopeOr400 } from '@/lib/http-scope';
import { flagGuard } from '@/lib/flags';
import { requireSession } from '@/lib/auth-guard';

/**
 * Post-ingest finalization step.
 *
 * The curate Lambda writes generated pages to S3 but does not touch any
 * derived artifacts. This route regenerates the affected space's `index.md`,
 * the scope's master `index.md`, and invalidates the in-memory Fuse search
 * cache so the new pages become discoverable.
 *
 * Idempotent: once a job's `finalized` flag is true, subsequent calls return
 * the current job without re-running the regeneration.
 */
export async function POST(req: Request) {
  const gate = await requireSession(req);
  if (gate) return gate;

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

  const scope = resolveScopeOr400({ scope: scopeName ?? 'shared', userId });
  if (scope instanceof NextResponse) return scope;
  const key = scope.systemKey(`jobs/${jobId}.json`);

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

  // Folders mode has no per-space index — the master index is a flat catalog of
  // the whole key tree (index-gen already branches on mode). Skip the
  // space-index regen that would otherwise write a `generated/<space>/index.md`.
  if (job.mode === 'folders') {
    await regenerateMasterIndex(scope);
  } else {
    await regenerateSpaceIndex(job.space, scope);
    await regenerateMasterIndex(scope);
  }
  invalidateSearchIndex();

  const updated = {
    ...job,
    finalized: true,
    finalizedAt: new Date().toISOString(),
  };
  await putObject(key, JSON.stringify(updated, null, 2));

  return NextResponse.json(updated);
}
