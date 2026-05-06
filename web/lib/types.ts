import type { ReactNode } from 'react';

export type Scope = 'shared' | 'personal';

export type SourceType = 'shared' | 'personal' | 'generated';

export type BodyKey = 'incident' | 'pipeline' | 'billing' | 'planning';

export type DocLeaf = {
  id: string;
  type: 'doc';
  name: string;
  meta?: string;
  tag?: 'generated';
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
  title: string;
  path: string;
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
