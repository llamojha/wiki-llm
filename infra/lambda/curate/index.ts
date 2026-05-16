import type { Context } from 'aws-lambda';
import { InvokeCommand, InvocationType, LambdaClient } from '@aws-sdk/client-lambda';
import type { CurateEvent } from './types.js';
import { processSource } from './ingest.js';
import { getJob, updateJob } from './job.js';

const TIMEOUT_BUFFER_MS = 30_000;
const lambdaClient = new LambdaClient({});

async function continueLater(event: CurateEvent, context: Context, startIndex: number): Promise<void> {
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

  console.log(`[${jobId}] Starting curate invocation at ${startIndex + 1}/${files.length}`);

  for (let i = startIndex; i < files.length; i++) {
    // Check for cancellation
    const job = await getJob(bucket, prefix, jobId);
    if (job.status === 'cancelled') return;

    // Check remaining time
    const remaining = context.getRemainingTimeInMillis();
    if (remaining < TIMEOUT_BUFFER_MS) {
      await continueLater(event, context, i);
      return;
    }

    const rawKey = files[i];
    console.log(`[${jobId}] Processing file ${i + 1}/${files.length}: ${rawKey}`);

    // Mark file as processing
    await updateJob(bucket, prefix, jobId, {
      completed: i,
      files: job.files.map((f, idx) =>
        idx === i ? { ...f, status: 'processing' } : f
      ),
    });

    try {
      const pages = await processSource(bucket, prefix, space, rawKey, jobId);
      console.log(`[${jobId}] Done ${rawKey}: ${pages.length} page(s) written`);
      const updatedJob = await getJob(bucket, prefix, jobId);
      await updateJob(bucket, prefix, jobId, {
        completed: i + 1,
        files: updatedJob.files.map((f, idx) =>
          idx === i ? { ...f, status: 'done', pages } : f
        ),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[${jobId}] Error on ${rawKey}:`, err);
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
