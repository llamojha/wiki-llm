import matter from 'gray-matter';
import { NextResponse } from 'next/server';

import { regenerateIndexesForKey } from '@/lib/index-gen';
import { appendLog } from '@/lib/log-append';
import { getObject, listObjects, ObjectAlreadyExistsError, putObjectIfAbsent } from '@/lib/s3';
import { invalidateSearchIndex } from '@/lib/search';
import {
  displayPathForKey,
  isDocumentKey,
  personalPrefix,
  sourceTypeFromKey,
} from '@/lib/vault-paths';

type DocSummary = {
  id: string;
  title: string;
  path: string;
  source_type: string;
  updated: string;
  author: string;
  tags: string[];
  starred: boolean;
  snippet: string;
};

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

function keyToTitle(key: string): string {
  const stem = key.split('/').pop()!.replace(/\.md$/, '');
  return stem.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractSnippet(content: string): string {
  return content
    .replace(/[#*_`>\[\]()!~|]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 160);
}

async function summarizeDoc(key: string): Promise<DocSummary | null> {
  try {
    const raw = await getObject(key);
    const { data: fm, content } = matter(raw);
    return {
      id: key,
      title: (fm.title as string) || keyToTitle(key),
      path: displayPathForKey(key),
      source_type: (fm.source_type as string) || sourceTypeFromKey(key),
      updated: (fm.updated as string) ?? '',
      author: (fm.author as string) ?? 'unknown',
      tags: Array.isArray(fm.tags) ? fm.tags : fm.tags ? [String(fm.tags)] : [],
      starred: fm.starred === true,
      snippet: extractSnippet(content),
    };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const view = searchParams.get('view') ?? 'recent';
  const requestedLimit = Number(searchParams.get('limit') ?? 20);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, 50))
    : 20;

  if (!['recent', 'starred'].includes(view)) {
    return NextResponse.json({ detail: 'view must be recent or starred' }, { status: 400 });
  }

  const keys = (await listObjects()).filter(isDocumentKey);
  const docs: DocSummary[] = [];
  for (let i = 0; i < keys.length; i += 20) {
    const batch = keys.slice(i, i + 20);
    const summaries = await Promise.all(batch.map(summarizeDoc));
    docs.push(...summaries.filter((doc): doc is DocSummary => Boolean(doc)));
  }

  const filtered = view === 'starred' ? docs.filter((doc) => doc.starred) : docs;
  filtered.sort((a, b) => {
    const at = Date.parse(a.updated);
    const bt = Date.parse(b.updated);
    return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
  });

  return NextResponse.json(filtered.slice(0, limit));
}

export async function POST(req: Request) {
  const body = await req.json();
  const { title, body: content, slug } = body as {
    title?: string;
    body?: string;
    slug?: string;
  };

  if (!title || typeof content !== 'string') {
    return NextResponse.json(
      { detail: 'title and body are required' },
      { status: 400 },
    );
  }

  const docSlug = slug || slugify(title);
  if (!docSlug) {
    return NextResponse.json({ detail: 'slug could not be derived from title' }, { status: 400 });
  }
  const key = `${personalPrefix()}${docSlug}.md`;

  const fm = {
    title,
    source_type: 'personal',
    author: 'you',
    updated: new Date().toISOString(),
    starred: false,
  };

  const markdown = matter.stringify(content, fm);
  try {
    await putObjectIfAbsent(key, markdown);
  } catch (err) {
    if (err instanceof ObjectAlreadyExistsError) {
      return NextResponse.json(
        { detail: `A page with slug "${docSlug}" already exists` },
        { status: 409 },
      );
    }
    throw err;
  }
  await regenerateIndexesForKey(key);
  await appendLog('created', key, title);
  invalidateSearchIndex();

  return NextResponse.json({ id: key, title, path: displayPathForKey(key) }, { status: 201 });
}
