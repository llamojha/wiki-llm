import type { ReactNode } from 'react';

/**
 * UI/data scope. Aligned with the backend scope (`web/lib/scope.ts`):
 * - `shared` — root-level vault content.
 * - `user`   — the active user's subtree under `users/<id>/`. This used to
 *   be called `personal`, but personal is a *space name*, not a scope; the
 *   user's tree contains personal **and** any other spaces they have content in.
 */
export type Scope = 'shared' | 'user';

export type SourceType = 'shared' | 'personal' | 'generated';

export type BodyKey = 'incident' | 'pipeline' | 'billing' | 'planning';

export type DocLeaf = {
  id: string;
  type: 'doc';
  name: string;
  meta?: string;
};

export type FolderNode = {
  id: string;
  type: 'folder';
  name: string;
  children: TreeNode[];
};

export type TreeNode = DocLeaf | FolderNode;

export type Cite = {
  id?: string;
  title: string;
  section: string;
};

export type AuthoredDoc = {
  title: string;
  path: string;
  s3: string;
  source: SourceType;
  updated: string;
  author: string;
  tags: string[];
  checksum: string;
  body: BodyKey;
  generated?: false;
};

export type GeneratedDoc = {
  title: string;
  path: string;
  s3: string;
  source: SourceType;
  updated: string;
  author: string;
  tags: string[];
  checksum: string;
  generated: true;
  question: string;
  answer: ReactNode;
  cites: Cite[];
};

export type Doc = AuthoredDoc | GeneratedDoc | LiveDoc;

/**
 * A document fetched from the API and rendered client-side.
 * _html is always the output of renderMarkdown() — never raw user input.
 */
export type LiveDoc = {
  generated: false;
  kind: 'live';
  /**
   * Relative S3 key (e.g. `users/<id>/authored/personal/foo.md`). Used as
   * the doc identity passed to APIs that take a key. Distinct from `s3`,
   * which is the full key including VAULT_PREFIX.
   */
  id: string;
  title: string;
  path: string;
  /** Full S3 key including VAULT_PREFIX. Display-only — never send to APIs. */
  s3: string;
  source: SourceType;
  updated: string;
  author: string;
  tags: string[];
  checksum: string;
  _html: SanitizedHtml;
  etag?: string;
  starred?: boolean;
  raw_markdown?: string;
};

/**
 * Branded type — only assignable via renderMarkdown(), never from raw strings.
 */
export type SanitizedHtml = string & { readonly __brand: 'SanitizedHtml' };

export type SearchHit = {
  id: string;
  title: string;
  path: string;
  source: SourceType;
  snippet: string;
  updated: string;
  score: number;
};
