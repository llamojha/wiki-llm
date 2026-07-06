import matter from 'gray-matter';
import { NextResponse } from 'next/server';

import { ConcurrencyError, getObjectWithETag, putObject } from '@/lib/s3';
import { upsertSearchEntry } from '@/lib/search';
import { isDocumentKey, isHtmlKey } from '@/lib/vault-paths';
import { flagGuard } from '@/lib/flags';
import { requireSession } from '@/lib/auth-guard';

type Params = { params: Promise<{ id: string[] }> };

export async function PATCH(req: Request, { params }: Params) {
  const gate = await requireSession(req);
  if (gate) return gate;
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

  // Starring persists a `starred` flag via gray-matter frontmatter, which an
  // HTML document cannot carry — writing it would inject YAML into the `.html`
  // object. HTML is browse/upload-only (plan 022 §1), so it is not starrable.
  if (isHtmlKey(key)) {
    return NextResponse.json(
      { detail: 'HTML documents cannot be starred' },
      { status: 400 },
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

  // The home view's starred filter reads from the cached search index, so a
  // toggle must refresh that entry — otherwise the change wouldn't surface
  // there until the next unrelated write.
  await upsertSearchEntry(key);

  return NextResponse.json({ id: key, starred, etag: newEtag });
}
