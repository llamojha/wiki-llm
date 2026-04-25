import matter from 'gray-matter';
import { NextResponse } from 'next/server';

import { ConcurrencyError, getObjectWithETag, putObject } from '@/lib/s3';
import { flagGuard } from '@/lib/flags';

type Params = { params: Promise<{ id: string[] }> };

export async function PATCH(_req: Request, { params }: Params) {
  const blocked = flagGuard('star');
  if (blocked) return blocked;

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
