import matter from 'gray-matter';
import { NextResponse } from 'next/server';

import { ConcurrencyError, getObjectWithETag, putObject } from '@/lib/s3';
import { isDocumentKey } from '@/lib/vault-paths';
import { flagGuard } from '@/lib/flags';

type Params = { params: Promise<{ id: string[] }> };

export async function PATCH(_req: Request, { params }: Params) {
  const blocked = flagGuard('star');
  if (blocked) return blocked;

  const { id } = await params;
  const key = decodeURIComponent(id.join('/'));

  // Star only mutates real documents. Without this, an arbitrary key could be
  // round-tripped through gray-matter and rewritten (e.g. injecting frontmatter
  // into `_system/` state). 404 for symmetry with the not-found path below and
  // to avoid leaking which keys exist.
  if (!isDocumentKey(key)) {
    return NextResponse.json(
      { detail: `Document not found: ${key}` },
      { status: 404 },
    );
  }

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

  const { data: fm, content } = matter(raw);
  const starred = fm.starred !== true;
  fm.starred = starred;

  const updated = matter.stringify(content, fm);
  let newEtag: string;
  try {
    newEtag = await putObject(key, updated, etag);
  } catch (err) {
    if (err instanceof ConcurrencyError) {
      return NextResponse.json(
        { detail: 'Conflict: document was modified. Retry.' },
        { status: 409 },
      );
    }
    throw err;
  }

  return NextResponse.json({ id: key, starred, etag: newEtag });
}
