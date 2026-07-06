import { NextResponse } from 'next/server';
import { putObject } from '@/lib/s3';
import { type Scope } from '@/lib/scope';
import { resolveScopeOr400 } from '@/lib/http-scope';
import { regenerateMasterIndex, regenerateSpaceIndex } from '@/lib/index-gen';
import { upsertSearchEntry } from '@/lib/search';
import { appendLog } from '@/lib/log-append';
import { ensureSpaceInStructure } from '@/lib/vault-structure';
import { PERSONAL_SPACE } from '@/lib/vault-paths';
import { ensureVaultMode, vaultMode } from '@/lib/vault-mode';
import { flagGuard, isEnabled } from '@/lib/flags';
import { requireSession } from '@/lib/auth-guard';

const SPACE_RE = /^[a-z0-9][a-z0-9-]*$/;
// A subfolder is a chain of space-shaped segments (`guides`, `guides/setup`).
const FOLDER_SEGMENT_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Max accepted upload size in bytes. Override with UPLOAD_MAX_BYTES. */
const UPLOAD_MAX_BYTES = (() => {
  const raw = Number(process.env.UPLOAD_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 2 * 1024 * 1024; // 2 MiB default
})();

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
  const gate = await requireSession(req);
  if (gate) return gate;

  const blocked = flagGuard('upload');
  if (blocked) return blocked;

  // Reject before `req.formData()` buffers the whole body into memory — that
  // parse is the actual DoS surface, so a post-parse `file.size` check alone
  // is too late. Content-Length covers the entire multipart body (file +
  // fields + boundaries), so it's an upper bound on the file size: if the
  // body fits the cap the file does too. Absent/lying Content-Length (e.g.
  // chunked transfer) still falls through to the exact `file.size` check
  // below — a fully streaming cap would need a custom multipart parser, out
  // of scope for the single-user MVP.
  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > UPLOAD_MAX_BYTES) {
    return NextResponse.json(
      { detail: `request body exceeds the ${UPLOAD_MAX_BYTES}-byte upload limit` },
      { status: 413 },
    );
  }

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

  // A `raw` upload is only ever processed by the curate pipeline. With curate
  // disabled the file would sit in raw/ forever (no Pending tab, reindex skips
  // raw/), so reject it rather than write an orphan. The UI hides the raw
  // option in this case; this guard is the enforcement.
  if (destination === 'raw' && !isEnabled('curate')) {
    return NextResponse.json(
      { detail: 'raw destination requires the curate feature' },
      { status: 400 },
    );
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

  // HTML is a first-class content type (plan 022) — accepted as upload/authored
  // input alongside Markdown. Curate (raw) stays Markdown-generating, but an
  // authored `.html` upload lands as a browsable/searchable document.
  if (!file.name.endsWith('.md') && !file.name.endsWith('.html')) {
    return NextResponse.json({ detail: 'only .md and .html files are accepted' }, { status: 400 });
  }

  // Cap the payload before reading it into memory (`file.text()` below). The
  // App Router imposes no legacy body-size limit, so without this an oversized
  // upload exhausts the shared Next.js process's memory.
  if (file.size > UPLOAD_MAX_BYTES) {
    return NextResponse.json(
      { detail: `file exceeds the ${UPLOAD_MAX_BYTES}-byte upload limit` },
      { status: 413 },
    );
  }

  const scope = resolveScopeOr400({ scope: scopeName, userId });
  if (scope instanceof NextResponse) return scope;
  await ensureVaultMode();
  const folders = vaultMode() === 'folders';
  const filename = sanitizeFilename(file.name);
  const folderPrefix = folder ? `${folder}/` : '';
  // Folders mode writes directly to the chosen folder (`<space>/<folder>/file`),
  // with no `authored/<space>/` provenance prefix. The top-level `space` is just
  // the first path segment.
  const authoredKey = folders
    ? `${space}/${folderPrefix}${filename}`
    : `${scope.authoredPrefix(space as string)}${folderPrefix}${filename}`;
  const key = destination === 'raw'
    ? `${scope.rawPrefix}${folderPrefix}${filename}`
    : authoredKey;
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
    // Folders mode has no `structure.json` — the tree is the key tree, so the
    // uploaded file shows up with no declaration.
    if (!folders && space && space !== PERSONAL_SPACE) {
      await ensureSpaceInStructure(space, scope.scope, scope.userId);
    }
    await regenerateSpaceIndex(space as string, scope);
    await regenerateMasterIndex(scope);
    await appendLog('created', key, filename.replace(/\.md$/, ''), scope);
    await upsertSearchEntry(key);
  }

  return NextResponse.json(
    { key, scope: scope.scope, userId: scope.userId, destination, space: space ?? null, folder: folder || null },
    { status: 201 },
  );
}
