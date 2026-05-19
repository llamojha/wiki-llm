import type { Context } from 'aws-lambda';
import { InvokeCommand, InvocationType, LambdaClient } from '@aws-sdk/client-lambda';
import type { CurateEvent, FileStage, JobState } from './types.js';
import { processSource, loadPlacementHints } from './ingest.js';
import { getJob, updateJob } from './job.js';
import { getGeneratedSpace } from './structure.js';
import { resolveScope } from './scope.js';

const TIMEOUT_BUFFER_MS = 30_000;
const DEFAULT_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.CURATE_CONCURRENCY ?? '3', 10) || 3,
);
const lambdaClient = new LambdaClient({});

/**
 * Serialize job-JSON writes so concurrent workers don't clobber each other.
 *
 * Each enqueued function runs after the previous one has settled (success or
 * failure). The queue itself never rejects.
 */
function createWriteQueue(): <T>(fn: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn) as Promise<T>;
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}

async function continueLater(
  event: CurateEvent,
  context: Context,
  startIndex: number,
): Promise<void> {
  console.log(`[${event.jobId}] Chaining Lambda at file ${startIndex + 1}/${event.files.length}`);
  await lambdaClient.send(new InvokeCommand({
    FunctionName: context.functionName,
    InvocationType: InvocationType.Event,
    Payload: new TextEncoder().encode(JSON.stringify({ ...event, startIndex })),
  }));
}

export async function handler(event: CurateEvent, context: Context): Promise<void> {
  const { jobId, space, files, bucket, prefix } = event;
  const startIndex = event.startIndex ?? 0;
  const scope = resolveScope({
    scope: event.scope ?? 'shared',
    userId: event.userId,
  });

  console.log(`[${jobId}] Starting curate invocation at ${startIndex + 1}/${files.length} scope=${scope.scope}${scope.userId ? `:${scope.userId}` : ''} (concurrency=${DEFAULT_CONCURRENCY})`);

  // Clear `phase` on entry — if we're a chained continuation, the prior
  // invocation set phase='chaining' before invoking us.
  const initialJob = await getJob(bucket, prefix, scope, jobId);
  if (initialJob.phase) {
    await updateJob(bucket, prefix, scope, jobId, { phase: undefined, chainedAt: undefined });
  }

  // Pass A — load placement hints **once** per invocation, not per file.
  const ingestSpace = await getGeneratedSpace(bucket, prefix);
  const hintsStart = Date.now();
  const hints = await loadPlacementHints(bucket, prefix, scope, ingestSpace);
  console.log(`[${jobId}] Loaded ${hints.length} placement hint(s) in ${Date.now() - hintsStart}ms`);

  // All job-JSON writes flow through this queue (Pass B).
  const enqueueWrite = createWriteQueue();

  // Pull-based worker pool: workers race to claim the next index.
  let nextIndex = startIndex;
  let stoppedForTimeout = false;
  let cancelled = false;

  async function runOne(i: number): Promise<void> {
    // Cancel check before any work for this file.
    const job = await getJob(bucket, prefix, scope, jobId);
    if (job.status === 'cancelled') { cancelled = true; return; }

    const rawKey = files[i];
    const startedAt = new Date().toISOString();
    console.log(`[${jobId}] Processing file ${i + 1}/${files.length}: ${rawKey}`);

    // Mark file as processing.
    await enqueueWrite(async () => {
      const current = await getJob(bucket, prefix, scope, jobId);
      await updateJob(bucket, prefix, scope, jobId, {
        files: current.files.map((f, idx) =>
          idx === i ? { ...f, status: 'processing', startedAt, stage: 'reading' } : f,
        ),
      });
    });

    const reportStage = (stage: FileStage): Promise<void> => enqueueWrite(async () => {
      try {
        const current = await getJob(bucket, prefix, scope, jobId);
        if (current.status === 'cancelled') return;
        await updateJob(bucket, prefix, scope, jobId, {
          files: current.files.map((f, idx) => (idx === i ? { ...f, stage } : f)),
        });
      } catch (err) {
        console.warn(`[${jobId}] stage update failed (${stage}):`, err);
      }
    });

    try {
      const pages = await processSource(bucket, prefix, space, rawKey, hints, scope, jobId, reportStage, enqueueWrite);
      console.log(`[${jobId}] Done ${rawKey}: ${pages.length} page(s) written`);
      const finishedAt = new Date().toISOString();
      await enqueueWrite(async () => {
        const current = await getJob(bucket, prefix, scope, jobId);
        const nextFiles = current.files.map((f, idx) =>
          idx === i
            ? { ...f, status: 'done' as const, pages, finishedAt, stage: undefined }
            : f,
        );
        const completed = nextFiles.filter(f => f.status === 'done' || f.status === 'error').length;
        await updateJob(bucket, prefix, scope, jobId, { completed, files: nextFiles });
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[${jobId}] Error on ${rawKey}:`, err);
      const finishedAt = new Date().toISOString();
      await enqueueWrite(async () => {
        const current = await getJob(bucket, prefix, scope, jobId);
        const nextFiles = current.files.map((f, idx) =>
          idx === i
            ? { ...f, status: 'error' as const, error: msg, finishedAt, stage: undefined }
            : f,
        );
        const completed = nextFiles.filter(f => f.status === 'done' || f.status === 'error').length;
        await updateJob(bucket, prefix, scope, jobId, { completed, files: nextFiles });
      });
    }
  }

  async function worker(): Promise<void> {
    for (;;) {
      if (cancelled || stoppedForTimeout) return;

      const remaining = context.getRemainingTimeInMillis();
      if (remaining < TIMEOUT_BUFFER_MS) {
        stoppedForTimeout = true;
        return;
      }

      const i = nextIndex++;
      if (i >= files.length) return;

      await runOne(i);
    }
  }

  const pending = files.length - startIndex;
  const workerCount = Math.min(DEFAULT_CONCURRENCY, Math.max(1, pending));
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  // Drain any queued writes before deciding next step.
  await enqueueWrite(async () => {});

  if (cancelled) return;

  if (stoppedForTimeout) {
    // Find the first unfinished file so the next invocation resumes there.
    const finalJob: JobState = await getJob(bucket, prefix, scope, jobId);
    const firstUnfinishedIdx = finalJob.files.findIndex(
      f => f.status !== 'done' && f.status !== 'error',
    );
    const resumeAt = firstUnfinishedIdx === -1 ? files.length : firstUnfinishedIdx;
    if (resumeAt < files.length) {
      // Pass D — make the chain handoff visible to the UI.
      await updateJob(bucket, prefix, scope, jobId, {
        phase: 'chaining',
        chainedAt: new Date().toISOString(),
      });
      await continueLater(event, context, resumeAt);
      return;
    }
  }

  // Mark job done.
  await updateJob(bucket, prefix, scope, jobId, {
    status: 'done',
    completedAt: new Date().toISOString(),
    phase: undefined,
    chainedAt: undefined,
  });
}
