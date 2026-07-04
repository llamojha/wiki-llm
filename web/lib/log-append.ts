import { putObject } from '@/lib/s3';
import { inferScopeFromKey, resolveScope, type ScopePaths } from '@/lib/scope';

/**
 * Record a single audit event as one object under the scope's
 * `_system/log/` prefix (`_system/log/<ts>-<rand>.md`).
 *
 * If a scope is not provided, the scope is inferred from the document key
 * (`users/<id>/...` → user scope, else shared). Pass an explicit scope when
 * logging an event that isn't tied to a single key (e.g., a batch curate run).
 *
 * One object per event is conflict-free by construction: distinct S3 PUTs
 * never race, so concurrent writers can no longer lose each other's appends
 * the way a shared read-modify-write `log.md` did. The legacy single-file
 * `_system/log.md` (where it exists) stays as historical content. See
 * `docs/configuration.md` for concatenating events back into one view.
 */
export async function appendLog(
  action: 'created' | 'edited' | 'deleted' | 'curated',
  path: string,
  title: string,
  scope?: ScopePaths,
): Promise<void> {
  const target = scope ?? (path ? inferScopeFromKey(path) : resolveScope({ scope: 'shared' }));
  const ts = new Date().toISOString();
  const rand = Math.random().toString(36).slice(2, 8);
  const key = target.systemKey(`log/${ts.replace(/[:.]/g, '-')}-${rand}.md`);
  const line = `- ${ts} | ${action} | ${path} | "${title}"`;
  await putObject(key, `${line}\n`);
}
