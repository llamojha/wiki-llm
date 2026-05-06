const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

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
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { next: { revalidate: 30 } });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const getTree = (vaultId = 'default') =>
  get<ApiTreeNode[]>(`/api/vaults/${vaultId}/tree`);

export const getDoc = (docId: string) =>
  get<ApiDoc>(`/api/docs/${encodeURIComponent(docId)}`);

export const search = (q: string) =>
  get<ApiSearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`);
