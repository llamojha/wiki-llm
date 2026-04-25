import { getObject, putObject } from '@/lib/s3';
import { inferScopeFromKey, resolveScope, type ScopePaths } from '@/lib/scope';

/**
 * Append a single event line to log.md in the given scope's `_system/`.
 *
 * If a scope is not provided, the scope is inferred from the document key
 * (`users/<id>/...` → user scope, else shared). Pass an explicit scope when
 * logging an event that isn't tied to a single key (e.g., a batch curate run).
 *
 * Known limitation: read-modify-write without concurrency control.
 * Concurrent writes can overwrite each other. Acceptable for single-user MVP.
 */
export async function appendLog(
  action: 'created' | 'edited' | 'deleted' | 'curated',
  path: string,
  title: string,
  scope?: ScopePaths,
): Promise<void> {
  const target = scope ?? (path ? inferScopeFromKey(path) : resolveScope({ scope: 'shared' }));
  const key = target.systemKey('log.md');

  let existing = '';
  try {
    existing = await getObject(key);
  } catch {
    // log.md doesn't exist yet — start fresh
  }

  const line = `- ${new Date().toISOString()} | ${action} | ${path} | "${title}"`;
  const content = existing ? `${existing.trimEnd()}\n${line}\n` : `${line}\n`;
  await putObject(key, content);
}
