import { getObject, putObject } from './s3.js';

const MAX_LOG_SIZE = 100 * 1024; // 100KB

/**
 * Append an event to log.md. Auto-rotates when size exceeds 100KB.
 */
export async function appendLog(
  action: string,
  path: string,
  detail: string,
): Promise<void> {
  let existing = '';
  try {
    existing = await getObject('log.md');
  } catch {
    // log.md doesn't exist yet
  }

  // Rotate if too large
  if (existing.length > MAX_LOG_SIZE) {
    const archiveKey = `log-${new Date().toISOString().slice(0, 10)}.md`;
    await putObject(archiveKey, existing);
    existing = '';
  }

  const line = `- ${new Date().toISOString()} | ${action} | ${path} | ${detail}`;
  const content = existing ? `${existing.trimEnd()}\n${line}\n` : `${line}\n`;
  await putObject('log.md', content);
}
