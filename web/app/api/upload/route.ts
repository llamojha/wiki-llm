import { NextResponse } from 'next/server';
import { putObject } from '@/lib/s3';
import { resolveScope, type Scope } from '@/lib/scope';
import { regenerateMasterIndex, regenerateSpaceIndex } from '@/lib/index-gen';
import { invalidateSearchIndex } from '@/lib/search';
import { appendLog } from '@/lib/log-append';
import { ensureSpaceInStructure } from '@/lib/vault-structure';
import { PERSONAL_SPACE } from '@/lib/vault-paths';
import { flagGuard } from '@/lib/flags';

const SPACE_RE = /^[a-z0-9][a-z0-9-]*$/;
// A subfolder is a chain of space-shaped segments (`guides`, `guides/setup`).
const FOLDER_SEGMENT_RE = /^[a-z0-9][a-z0-9-]*$/;

function sanitizeFilename(name: string): string {
  // Strip path separators, keep only the basename, ensure .md extension
  return name.replace(/[/\\]/g, '').replace(/[^a-zA-Z0-9._-]/g, '-');
}

/**
 * Normalize an optional subfolder path supplied with an upload.
 *
 * Returns a clean relative path with no leading/trailing slashes
 * (e.g. `"guides/setup"`), or `''` when no folder was given. Returns `null`
 * when the path is malformed so the caller can reject with a 400 rather than
 * writing to a surprising key. Each segment must match the same shape as a
 * space name, which keeps S3 keys lowercase and rejects `..` traversal.
 */
function normalizeFolder(raw: string | null): string | null {
  if (!raw) return '';
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return '';
  const segments = trimmed.split('/').filter(Boolean);
  for (const seg of segments) {
    if (!FOLDER_SEGMENT_RE.test(seg)) return null;
  }
  return segments.join('/');
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
  const blocked = flagGuard('upload');
  if (blocked) return blocked;

  const form = await req.formData();
  const file = form.get('file') as File | null;
  const space = form.get('space') as string | null;
  const destination = ((form.get('destination') as string | null) ?? 'raw') as 'raw' | 'authored';
  const scopeName = ((form.get('scope') as string | null) ?? 'shared') as Scope;
  const userId = (form.get('userId') as string | null) ?? undefined;
  const folder = normalizeFolder(form.get('folder') as string | null);

  if (!file) {
    return NextResponse.json({ detail: 'file is required' }, { status: 400 });
  }

  if (destination !== 'raw' && destination !== 'authored') {
    return NextResponse.json({ detail: 'destination must be raw or authored' }, { status: 400 });
  }

  if (folder === null) {
    return NextResponse.json(
      { detail: 'folder segments must be lowercase alphanumeric with hyphens only' },
      { status: 400 },
    );
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
  const folderPrefix = folder ? `${folder}/` : '';
  const key = destination === 'raw'
    ? `${scope.rawPrefix}${folderPrefix}${filename}`
    : `${scope.authoredPrefix(space as string)}${folderPrefix}${filename}`;
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
    // Declare the space in structure.json if it isn't already. Without this
    // the file lands in S3 (and is reachable by direct URL) but never shows
    // in the sidebar tree, which only walks declared `indexed` spaces. The
    // personal space is reserved and surfaced separately, so never declare it.
    if (space && space !== PERSONAL_SPACE) {
      await ensureSpaceInStructure(space);
    }
    await regenerateSpaceIndex(space as string, scope);
    await regenerateMasterIndex(scope);
    await appendLog('created', key, filename.replace(/\.md$/, ''), scope);
    invalidateSearchIndex();
  }

  return NextResponse.json(
    { key, scope: scope.scope, userId: scope.userId, destination, space: space ?? null, folder: folder || null },
    { status: 201 },
  );
}
