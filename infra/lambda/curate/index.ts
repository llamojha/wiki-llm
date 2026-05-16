import type { Context } from 'aws-lambda';
import type { CurateEvent } from './types.js';
import { processSource } from './ingest.js';
import { getJob, updateJob } from './job.js';

const TIMEOUT_BUFFER_MS = 30_000;

export async function handler(event: CurateEvent, context: Context): Promise<void> {
  const { jobId, space, files, bucket, prefix } = event;

  for (let i = 0; i < files.length; i++) {
    // Check for cancellation
    const job = await getJob(bucket, prefix, jobId);
    if (job.status === 'cancelled') return;

    // Check remaining time
    const remaining = context.getRemainingTimeInMillis();
    if (remaining < TIMEOUT_BUFFER_MS) {
      await updateJob(bucket, prefix, jobId, {
        status: 'error',
        error: `Timed out after ${i} of ${files.length} files`,
        completedAt: new Date().toISOString(),
      });
      return;
    }

    // Mark file as processing
    await updateJob(bucket, prefix, jobId, {
      completed: i,
      files: job.files.map((f, idx) =>
        idx === i ? { ...f, status: 'processing' } : f
      ),
    });

    try {
      const pages = await processSource(bucket, prefix, space, files[i]);
      const updatedJob = await getJob(bucket, prefix, jobId);
      await updateJob(bucket, prefix, jobId, {
        completed: i + 1,
        files: updatedJob.files.map((f, idx) =>
          idx === i ? { ...f, status: 'done', pages } : f
        ),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      const updatedJob = await getJob(bucket, prefix, jobId);
      await updateJob(bucket, prefix, jobId, {
        completed: i + 1,
        files: updatedJob.files.map((f, idx) =>
          idx === i ? { ...f, status: 'error', error: msg } : f
        ),
      });
    }
  }

  // Mark job done
  await updateJob(bucket, prefix, jobId, {
    status: 'done',
    completedAt: new Date().toISOString(),
  });
}
