import { BASE_PATH } from './base-path';

// API origin/prefix. NEXT_PUBLIC_API_URL (if set) wins for an absolute origin;
// otherwise fall back to the base path so requests hit the sub-path the app is
// served under (e.g. /wiki/api/...).
const BASE = process.env.NEXT_PUBLIC_API_URL ?? BASE_PATH;

export type ApiTreeNode =
  | { type: 'doc'; id: string; name: string }
  | { type: 'folder'; id: string; name: string; children: ApiTreeNode[] };

export type ApiDoc = {
  id: string;
  title: string;
  path: string;
  s3_key: string;
  source_type: string;
  updated: string;
  author: string;
  tags: string[];
  checksum: string;
  raw_markdown: string;
  etag: string;
  starred: boolean;
};

export type ApiSearchResult = {
  id: string;
  title: string;
  path: string;
  snippet: string;
  rank: number;
  updated: string;
  source_type: string;
};

async function get<T>(path: string): Promise<T> {
  // Never serve a cached response: the tree, docs, and search all reflect live
  // S3 state and the backing routes are `force-dynamic`. A stale Data Cache
  // here was the cause of "uploaded file doesn't show in the sidebar" — the
  // refresh fetch returned a tree snapshot from before the write.
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const getTree = (vaultId = 'default') =>
  get<ApiTreeNode[]>(`/api/vaults/${vaultId}/tree`);

export const getDoc = (docId: string) =>
  get<ApiDoc>(`/api/docs/${encodeURIComponent(docId)}`);

export type ApiSearchOptions = {
  scope?: 'shared' | 'user' | 'both';
  userId?: string;
  folder?: string;
};

export const search = (q: string, opts: ApiSearchOptions = {}) => {
  const params = new URLSearchParams({ q });
  if (opts.scope) params.set('scope', opts.scope);
  if (opts.userId) params.set('userId', opts.userId);
  if (opts.folder) params.set('folder', opts.folder);
  return get<ApiSearchResult[]>(`/api/search?${params.toString()}`);
};
