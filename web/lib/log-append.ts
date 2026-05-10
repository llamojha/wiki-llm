import { getObject, putObject } from '@/lib/s3';

/**
 * Append a single event line to log.md in S3.
 *
 * Known limitation: read-modify-write without concurrency control.
 * Concurrent writes can overwrite each other. Acceptable for single-user MVP.
 * Future fix: use S3 conditional writes (IfMatch) with retry on conflict.
 */
export async function appendLog(
  action: 'created' | 'edited' | 'deleted' | 'curated',
  path: string,
  title: string,
): Promise<void> {
  let existing = '';
  try {
    existing = await getObject('log.md');
  } catch {
    // log.md doesn't exist yet — start fresh
  }

  const line = `- ${new Date().toISOString()} | ${action} | ${path} | "${title}"`;
  const content = existing ? `${existing.trimEnd()}\n${line}\n` : `${line}\n`;
  await putObject('log.md', content);
}
