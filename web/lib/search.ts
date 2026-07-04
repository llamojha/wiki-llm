import Fuse from 'fuse.js';
import matter from 'gray-matter';

import { fmString, fmStringOr } from '@/lib/frontmatter';
import { getObject, listObjects } from '@/lib/s3';
import { inferScopeFromKey } from '@/lib/scope';
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

async function buildIndex(): Promise<SearchIndex> {
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
          const { data } = matter(raw);
          const title = fmStringOr(data.title, keyToTitle(key));
          const path = displayPathForKey(key);
          const updated = fmString(data.updated);
          const sourceType = fmStringOr(data.source_type, sourceTypeFromKey(key));
          entries.push({
            id: key,
            title,
            path,
            snippet: extractSnippet(raw),
            updated,
            source_type: sourceType,
            author: fmStringOr(data.author, 'unknown'),
            tags: Array.isArray(data.tags) ? data.tags : data.tags ? [String(data.tags)] : [],
            starred: data.starred === true,
          });
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
  if (!_promise) _promise = buildIndex();
  return _promise;
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

/** Clear the cached search index so it rebuilds on next search request. */
export function invalidateSearchIndex(): void {
  _promise = null;
}
