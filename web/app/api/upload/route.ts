import { NextResponse } from 'next/server';
import { putObject } from '@/lib/s3';
import { resolveScope, type Scope } from '@/lib/scope';
import { regenerateMasterIndex, regenerateSpaceIndex } from '@/lib/index-gen';
import { invalidateSearchIndex } from '@/lib/search';
import { appendLog } from '@/lib/log-append';

const SPACE_RE = /^[a-z0-9][a-z0-9-]*$/;

function sanitizeFilename(name: string): string {
  // Strip path separators, keep only the basename, ensure .md extension
  return name.replace(/[/\\]/g, '').replace(/[^a-zA-Z0-9._-]/g, '-');
}

/**
 * Upload a file into the vault.
 *
 * Two destinations:
 *   - `raw` — file lands in the scope's raw prefix, will be processed by AI
 *     later (curate). No indexes touched here — curate's finalize step handles
 *     that.
 *   - `authored` — file lands directly in the scope's authored/<space>/. Treated
 *     as a final document: indexes regenerated, log appended, search cache
 *     invalidated inline.
 *
 * Both destinations work for both `shared` and `user` scopes.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('file') as File | null;
  const space = form.get('space') as string | null;
  const destination = ((form.get('destination') as string | null) ?? 'raw') as 'raw' | 'authored';
  const scopeName = ((form.get('scope') as string | null) ?? 'shared') as Scope;
  const userId = (form.get('userId') as string | null) ?? undefined;

  if (!file) {
    return NextResponse.json({ detail: 'file is required' }, { status: 400 });
  }

  if (destination !== 'raw' && destination !== 'authored') {
    return NextResponse.json({ detail: 'destination must be raw or authored' }, { status: 400 });
  }

  if (destination === 'authored') {
    if (!space) {
      return NextResponse.json({ detail: 'space is required for authored destination' }, { status: 400 });
    }
    if (!SPACE_RE.test(space)) {
      return NextResponse.json(
        { detail: 'space must be lowercase alphanumeric with hyphens only' },
        { status: 400 },
      );
    }
  }

  if (!file.name.endsWith('.md')) {
    return NextResponse.json({ detail: 'only .md files are accepted' }, { status: 400 });
  }

  const scope = resolveScope({ scope: scopeName, userId });
  const filename = sanitizeFilename(file.name);
  const key = destination === 'raw'
    ? `${scope.rawPrefix}${filename}`
    : `${scope.authoredPrefix(space as string)}${filename}`;
  const content = await file.text();

  try {
    await putObject(key, content);
  } catch {
    return NextResponse.json({ detail: 'S3 write failed' }, { status: 500 });
  }

  // Authored uploads are final documents — run the same post-write side
  // effects as the CRUD path: scope-aware index regen, log append, search
  // invalidation. Raw uploads do none of this; curate handles them later.
  if (destination === 'authored') {
    await regenerateSpaceIndex(space as string, scope);
    await regenerateMasterIndex(scope);
    await appendLog('created', key, filename.replace(/\.md$/, ''), scope);
    invalidateSearchIndex();
  }

  return NextResponse.json(
    { key, scope: scope.scope, userId: scope.userId, destination, space: space ?? null },
    { status: 201 },
  );
}
