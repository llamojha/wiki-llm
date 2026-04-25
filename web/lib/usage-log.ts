import { getObject, putObject } from '@/lib/s3';
import type { ScopePaths } from '@/lib/scope';

/**
 * Append a chat interaction entry to `_system/usage-log.jsonl`.
 *
 * Best-effort: failures are warned and swallowed so logging never blocks
 * the user response. Per-scope: shared chats go to shared `_system/`, user
 * chats go to the user's `_system/`.
 *
 * Note: same naive read-modify-write concurrency profile as `log-append.ts`.
 * Acceptable for single-user MVP. A future improvement could batch writes
 * or use S3 conditional puts.
 */
export type ChatLogEntry = {
  scope: ScopePaths;
  question: string;
  answerChars: number;
  citeCount: number;
  toolCalls: number;
  durationMs: number;
  /** True if the user opted into unsourced generation for this turn. */
  forced?: boolean;
  /** Filled when the run yielded an error event instead of completing. */
  error?: string;
};

export async function logChatInteraction(entry: ChatLogEntry): Promise<void> {
  try {
    const key = entry.scope.systemKey('usage-log.jsonl');
    let existing = '';
    try {
      existing = await getObject(key);
    } catch {
      // First write — file doesn't exist yet.
    }

    const line = JSON.stringify({
      ts: new Date().toISOString(),
      scope: entry.scope.scope,
      userId: entry.scope.userId,
      question: entry.question,
      answerChars: entry.answerChars,
      citeCount: entry.citeCount,
      toolCalls: entry.toolCalls,
      durationMs: entry.durationMs,
      ...(entry.forced ? { forced: true } : {}),
      ...(entry.error ? { error: entry.error } : {}),
    });
    const content = existing ? `${existing.trimEnd()}\n${line}\n` : `${line}\n`;
    await putObject(key, content);
  } catch (err) {
    console.warn('[usage-log] write failed:', err);
  }
}
