import Fuse from 'fuse.js';
import matter from 'gray-matter';

import { fmString, fmStringOr } from '@/lib/frontmatter';
import { getObject, listObjects } from '@/lib/s3';
import { inferScopeFromKey } from '@/lib/scope';
import { ensureVaultMode } from '@/lib/vault-mode';
import { displayPathForKey, isDocumentKey, sourceTypeFromKey } from '@/lib/vault-paths';

export interface SearchEntry {
  id: string;
  title: string;
  path: string;
  snippet: string;
  updated: string;
  source_type: string;
  author: string;
  tags: string[];
  starred: boolean;
}

export interface SearchResult extends SearchEntry {
  rank: number;
}

export type SearchScope = 'shared' | 'user' | 'both';

export type SearchOptions = {
  scope?: SearchScope;
  userId?: string;
  folder?: string;
};

/**
 * The lazily-built index caches both the Fuse instance (for `search`) and the
 * raw entry array (for `getAllEntries`, which backs the home view). Both are
 * derived from the same single S3 crawl and invalidated together.
 */
interface SearchIndex {
  fuse: Fuse<SearchEntry>;
  entries: SearchEntry[];
}

let _promise: Promise<SearchIndex> | null = null;
// A synchronous handle on the built index, set once `_promise` resolves. Lets
// `removeSearchEntry` mutate the live index without awaiting. Cleared together
// with `_promise` on invalidation.
let _resolved: SearchIndex | null = null;

function keyToTitle(key: string): string {
  const stem = key.split('/').pop()!.replace(/\.md$/, '');
  return stem.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractSnippet(raw: string, maxChars = 200): string {
  let text = raw;
  if (text.startsWith('---')) {
    const end = text.indexOf('---', 3);
    if (end !== -1) text = text.slice(end + 3);
  }
  text = text.replace(/[#*_`>\[\]!|~]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.slice(0, maxChars);
}

/** Build one search entry from a document's raw Markdown. Single source of
 *  truth shared by the full crawl and the incremental upsert path. */
function entryForKey(key: string, raw: string): SearchEntry {
  const { data } = matter(raw);
  return {
    id: key,
    title: fmStringOr(data.title, keyToTitle(key)),
    path: displayPathForKey(key),
    snippet: extractSnippet(raw),
    updated: fmString(data.updated),
    source_type: fmStringOr(data.source_type, sourceTypeFromKey(key)),
    author: fmStringOr(data.author, 'unknown'),
    tags: Array.isArray(data.tags) ? data.tags : data.tags ? [String(data.tags)] : [],
    starred: data.starred === true,
  };
}

async function buildIndex(): Promise<SearchIndex> {
  await ensureVaultMode();
  const keys = await listObjects();
  const filtered = keys.filter(isDocumentKey);

  const entries: SearchEntry[] = [];
  const BATCH = 20;
  for (let i = 0; i < filtered.length; i += BATCH) {
    const batch = filtered.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (key) => {
        try {
          const raw = await getObject(key);
          entries.push(entryForKey(key, raw));
        } catch {
          // skip unreadable docs
        }
      }),
    );
  }

  const fuse = new Fuse(entries, {
    keys: [
      { name: 'title', weight: 2 },
      { name: 'snippet', weight: 1 },
      { name: 'path', weight: 0.5 },
    ],
    threshold: 0.4,
    includeScore: true,
  });
  return { fuse, entries };
}

function getIndex(): Promise<SearchIndex> {
  if (!_promise) {
    _promise = buildIndex();
    // Record the resolved index for the synchronous remove path. A failed
    // build leaves `_resolved` null so the next call rebuilds from scratch.
    _promise.then(
      (idx) => {
        _resolved = idx;
      },
      () => {
        _promise = null;
        _resolved = null;
      },
    );
  }
  return _promise;
}

/**
 * Upsert one document into the cached index. No-op when the cache is cold or
 * still building — the pending/next full build reads current S3 and picks the
 * change up, which is what keeps this safe on serverless. When warm: read the
 * object once, then mutate Fuse + the entries array with no `await` between the
 * remove and the add, so a concurrent search sees either the old or new entry,
 * never a half-updated index.
 */
export async function upsertSearchEntry(key: string): Promise<void> {
  if (!_promise) return;
  const index = await _promise;
  let raw: string;
  try {
    raw = await getObject(key);
  } catch {
    return; // unreadable (e.g. deleted between write and here) — leave as-is
  }
  const entry = entryForKey(key, raw);
  index.fuse.remove((doc) => (doc as SearchEntry).id === key);
  index.fuse.add(entry);
  const i = index.entries.findIndex((e) => e.id === key);
  if (i >= 0) index.entries[i] = entry;
  else index.entries.push(entry);
}

/** Remove one document from the cached index. No-op when the cache is cold or
 *  still building (the pending/next full build already reflects the deletion). */
export function removeSearchEntry(key: string): void {
  if (!_resolved) return;
  _resolved.fuse.remove((doc) => (doc as SearchEntry).id === key);
  const i = _resolved.entries.findIndex((e) => e.id === key);
  if (i >= 0) _resolved.entries.splice(i, 1);
}

export async function search(q: string, limit = 20): Promise<SearchResult[]> {
  if (!q.trim()) return [];
  const { fuse } = await getIndex();
  return fuse
    .search(q, { limit })
    .map((r) => ({ ...r.item, rank: 1 - (r.score ?? 0) }));
}

/** All indexed entries (search + home view). Built lazily, cached until invalidated. */
export async function getAllEntries(): Promise<SearchEntry[]> {
  return (await getIndex()).entries;
}

export async function searchScoped(
  q: string,
  limit = 20,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const overFetchLimit = Math.max(limit * 4, limit);
  const hits = await search(q, overFetchLimit);
  return hits
    .filter((hit) => isAllowedByScope(hit.id, options))
    .filter((hit) => !options.folder || hit.id.startsWith(options.folder))
    .slice(0, limit);
}

/** Exported for tests + route reuse. */
export function isAllowedByScope(key: string, options: SearchOptions): boolean {
  const scope = options.scope ?? 'both';
  if (scope === 'both') return true;
  const inferred = inferScopeFromKey(key);
  if (scope === 'shared') return inferred.scope === 'shared';
  return inferred.scope === 'user' && (!options.userId || inferred.userId === options.userId);
}

/** Clear the cached search index so it rebuilds on next search request. Used
 *  by bulk mutations (rename/delete/reindex) where incremental patching would
 *  be more complex than a full rebuild. */
export function invalidateSearchIndex(): void {
  _promise = null;
  _resolved = null;
}
