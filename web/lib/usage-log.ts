import { putObject } from '@/lib/s3';
import type { ScopePaths } from '@/lib/scope';

/**
 * Record a chat interaction as one object under the scope's `_system/usage/`
 * prefix (`_system/usage/<ts>-<rand>.json`, one JSON entry per file).
 *
 * Best-effort: failures are warned and swallowed so logging never blocks
 * the user response. Per-scope: shared chats go to shared `_system/`, user
 * chats go to the user's `_system/`.
 *
 * One object per event (like `log-append.ts`) is conflict-free by
 * construction — concurrent chat turns can no longer overwrite each other the
 * way the shared `_system/usage-log.jsonl` read-modify-write did. The `.json`
 * suffix keeps these out of document listings entirely (`listObjects` is
 * `.md`-only). See `docs/configuration.md` for the layout.
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
    const ts = new Date().toISOString();
    const rand = Math.random().toString(36).slice(2, 8);
    const key = entry.scope.systemKey(`usage/${ts.replace(/[:.]/g, '-')}-${rand}.json`);

    const line = JSON.stringify({
      ts,
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
    await putObject(key, `${line}\n`);
  } catch (err) {
    console.warn('[usage-log] write failed:', err);
  }
}
