import matter from 'gray-matter';
import { NextResponse } from 'next/server';

import { regenerateIndexesForKey } from '@/lib/index-gen';
import { appendLog } from '@/lib/log-append';
import { ObjectAlreadyExistsError, putObjectIfAbsent } from '@/lib/s3';
import { getAllEntries, upsertSearchEntry } from '@/lib/search';
import { displayPathForKey, personalPrefix } from '@/lib/vault-paths';
import { ensureVaultMode, vaultMode } from '@/lib/vault-mode';
import { flagGuard } from '@/lib/flags';
import { requireSession } from '@/lib/auth-guard';

const FOLDER_SEGMENT_RE = /^[a-z0-9][a-z0-9-]*$/;

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

export async function GET(req: Request) {
  const gate = await requireSession(req);
  if (gate) return gate;
  const { searchParams } = new URL(req.url);
  const view = searchParams.get('view') ?? 'recent';
  const requestedLimit = Number(searchParams.get('limit') ?? 20);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, 50))
    : 20;

  if (!['recent', 'starred'].includes(view)) {
    return NextResponse.json({ detail: 'view must be recent or starred' }, { status: 400 });
  }

  // Reuse the cached search index instead of re-crawling every document body.
  // The index already parses the same frontmatter; the home view is just a
  // different projection + sort over the same entries.
  const entries = await getAllEntries();
  const docs: DocSummary[] = entries.map((e) => ({
    id: e.id,
    title: e.title,
    path: e.path,
    source_type: e.source_type,
    updated: e.updated,
    author: e.author,
    tags: e.tags,
    starred: e.starred,
    snippet: e.snippet,
  }));

  const filtered = view === 'starred' ? docs.filter((doc) => doc.starred) : docs;
  filtered.sort((a, b) => {
    const at = Date.parse(a.updated);
    const bt = Date.parse(b.updated);
    return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
  });

  return NextResponse.json(filtered.slice(0, limit));
}

export async function POST(req: Request) {
  const gate = await requireSession(req);
  if (gate) return gate;

  const blocked = flagGuard('editor');
  if (blocked) return blocked;

  const body = await req.json();
  const { title, body: content, slug, folder } = body as {
    title?: string;
    body?: string;
    slug?: string;
    folder?: string;
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

  await ensureVaultMode();
  const folders = vaultMode() === 'folders';

  // Folders mode has no `users/` personal tree — new pages land in the
  // user-chosen folder (or the vault root), and provenance is a frontmatter
  // value rather than a path prefix.
  let key: string;
  if (folders) {
    const segments = (folder ?? '').split('/').map((s) => s.trim()).filter(Boolean);
    if (segments.some((s) => !FOLDER_SEGMENT_RE.test(s))) {
      return NextResponse.json(
        { detail: 'folder segments must be lowercase alphanumeric with hyphens only' },
        { status: 400 },
      );
    }
    const folderPrefix = segments.length ? `${segments.join('/')}/` : '';
    key = `${folderPrefix}${docSlug}.md`;
  } else {
    key = `${personalPrefix()}${docSlug}.md`;
  }

  const fm = {
    title,
    source_type: folders ? 'authored' : 'personal',
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
  await upsertSearchEntry(key);

  return NextResponse.json({ id: key, title, path: displayPathForKey(key) }, { status: 201 });
}
