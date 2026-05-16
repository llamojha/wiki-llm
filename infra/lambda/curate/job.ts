import type { JobState } from './types.js';
import { getObject, putJson } from './s3.js';

function jobKey(jobId: string): string {
  return `_jobs/${jobId}.json`;
}

export async function getJob(bucket: string, prefix: string, jobId: string): Promise<JobState> {
  const raw = await getObject(bucket, prefix, jobKey(jobId));
  return JSON.parse(raw) as JobState;
}

export async function updateJob(
  bucket: string,
  prefix: string,
  jobId: string,
  patch: Partial<JobState>,
): Promise<void> {
  const current = await getJob(bucket, prefix, jobId);
  // Preserve cancelled status — don't let a patch overwrite it
  if (current.status === 'cancelled' && !patch.status) {
    return;
  }
  const updated = current.status === 'cancelled'
    ? { ...current, ...patch, status: 'cancelled' as const }
    : { ...current, ...patch };
  await putJson(bucket, prefix, jobKey(jobId), updated);
}

export async function createJob(
  bucket: string,
  prefix: string,
  jobId: string,
  space: string,
  files: string[],
): Promise<JobState> {
  const job: JobState = {
    id: jobId,
    status: 'processing',
    space,
    total: files.length,
    completed: 0,
    files: files.map(key => ({ key, status: 'pending' })),
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };
  await putJson(bucket, prefix, jobKey(jobId), job);
  return job;
}
