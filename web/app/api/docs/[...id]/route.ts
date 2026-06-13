import matter from 'gray-matter';
import { NextResponse } from 'next/server';

import { regenerateIndexesForKey } from '@/lib/index-gen';
import { appendLog } from '@/lib/log-append';
import {
  ConcurrencyError,
  deleteObject,
  getObject,
  getObjectWithETag,
  putObject,
} from '@/lib/s3';
import { invalidateSearchIndex } from '@/lib/search';
import { displayPathForKey, isDocumentKey, sourceTypeFromKey } from '@/lib/vault-paths';
import { flagGuard } from '@/lib/flags';

type Params = { params: Promise<{ id: string[] }> };

function keyToTitle(key: string): string {
  const stem = key.split('/').pop()!.replace(/\.md$/, '');
  return stem.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const key = decodeURIComponent(id.join('/'));

  let raw: string;
  let etag: string;
  try {
    const result = await getObjectWithETag(key);
    raw = result.content;
    etag = result.etag;
  } catch {
    return NextResponse.json(
      { detail: `Document not found: ${key}` },
      { status: 404 },
    );
  }

  const { data: fm } = matter(raw);
  const prefix = process.env.VAULT_PREFIX ?? '';
  const s3Key = prefix ? `${prefix}/${key}`.replace(/^\//, '') : key;

  const doc = {
    id: key,
    title: (fm.title as string) || keyToTitle(key),
    path: displayPathForKey(key),
    s3_key: s3Key,
    source_type:
      (fm.source_type as string) ||
      sourceTypeFromKey(key),
    updated: (fm.updated as string) ?? '',
    author: (fm.author as string) ?? 'unknown',
    tags: Array.isArray(fm.tags) ? fm.tags : fm.tags ? [String(fm.tags)] : [],
    starred: fm.starred === true,
    checksum: etag.replace(/"/g, '').slice(0, 8),
    etag,
    raw_markdown: raw,
  };

  return NextResponse.json(doc);
}

export async function PUT(req: Request, { params }: Params) {
  const blocked = flagGuard('editor');
  if (blocked) return blocked;

  const { id } = await params;
  const key = decodeURIComponent(id.join('/'));

  // The editor may only write real documents. Without this, an arbitrary key
  // (e.g. `_themes/evil.css`) could be PUT with arbitrary content — which the
  // theme loader would then inline as a theme, defeating the "operator-only"
  // guarantee of THEME_VAULT_PREFIX. See docs/theming.md.
  if (!isDocumentKey(key)) {
    return NextResponse.json(
      { detail: `Not an editable document key: ${key}` },
      { status: 400 },
    );
  }

  const { body: content, etag, title } = (await req.json()) as {
    body: string;
    etag?: string;
    title?: string;
  };

  if (!content) {
    return NextResponse.json(
      { detail: 'body is required' },
      { status: 400 },
    );
  }

  // Parse incoming content and ensure frontmatter is preserved with updated timestamp
  const { data: fm, content: mdBody } = matter(content);
  if (title) fm.title = title;
  fm.updated = new Date().toISOString();
  const assembled = matter.stringify(mdBody, fm);

  try {
    await putObject(key, assembled, etag);
  } catch (err) {
    if (err instanceof ConcurrencyError) {
      return NextResponse.json(
        { detail: 'Conflict: document was modified. Reload and retry.' },
        { status: 409 },
      );
    }
    throw err;
  }

  const logTitle = (fm.title as string) || keyToTitle(key);
  await appendLog('edited', key, logTitle);
  await regenerateIndexesForKey(key);
  invalidateSearchIndex();

  return NextResponse.json({ id: key, title: logTitle });
}

export async function DELETE(_req: Request, { params }: Params) {
  const blocked = flagGuard('editor');
  if (blocked) return blocked;

  const { id } = await params;
  const key = decodeURIComponent(id.join('/'));

  // Same restriction as PUT: the editor only touches real documents, never
  // system objects or operator-controlled theme files.
  if (!isDocumentKey(key)) {
    return NextResponse.json(
      { detail: `Not an editable document key: ${key}` },
      { status: 400 },
    );
  }

  // Read title before deleting for the log entry
  let title = keyToTitle(key);
  try {
    const raw = await getObject(key);
    const { data: fm } = matter(raw);
    if (fm.title) title = fm.title as string;
  } catch {
    // doc may already be gone — proceed with delete anyway
  }

  await deleteObject(key);
  await regenerateIndexesForKey(key);
  await appendLog('deleted', key, title);
  invalidateSearchIndex();

  return new NextResponse(null, { status: 204 });
}
