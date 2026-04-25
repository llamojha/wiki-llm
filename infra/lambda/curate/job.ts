import type { JobState } from './types.js';
import { getObject, putJson } from './s3.js';
import type { ScopePaths } from './scope.js';

function jobKey(scope: ScopePaths, jobId: string): string {
  return scope.systemKey(`jobs/${jobId}.json`);
}

export async function getJob(
  bucket: string,
  prefix: string,
  scope: ScopePaths,
  jobId: string,
): Promise<JobState> {
  const raw = await getObject(bucket, prefix, jobKey(scope, jobId));
  return JSON.parse(raw) as JobState;
}

export async function updateJob(
  bucket: string,
  prefix: string,
  scope: ScopePaths,
  jobId: string,
  patch: Partial<JobState>,
): Promise<void> {
  const current = await getJob(bucket, prefix, scope, jobId);
  if (current.status === 'cancelled' && !patch.status) {
    return;
  }
  const updated = current.status === 'cancelled'
    ? { ...current, ...patch, status: 'cancelled' as const }
    : { ...current, ...patch };
  await putJson(bucket, prefix, jobKey(scope, jobId), updated);
}

export async function createJob(
  bucket: string,
  prefix: string,
  scope: ScopePaths,
  jobId: string,
  space: string,
  files: string[],
): Promise<JobState> {
  const job: JobState = {
    id: jobId,
    status: 'processing',
    space,
    scope: scope.scope,
    userId: scope.userId,
    total: files.length,
    completed: 0,
    files: files.map(key => ({ key, status: 'pending' })),
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };
  await putJson(bucket, prefix, jobKey(scope, jobId), job);
  return job;
}
