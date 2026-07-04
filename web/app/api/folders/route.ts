import { NextResponse } from 'next/server';

import { flagGuard } from '@/lib/flags';
import { InvalidUserIdError, type Scope } from '@/lib/scope';
import {
  SpaceError,
  createFolder,
  deleteFolder,
  listFolderTree,
  renameFolder,
} from '@/lib/folders';

/**
 * Nested folder management for the Library modal's Folders tab.
 *
 * A folder is addressed by its full path from the space root — a single
 * segment (`platform`) is a top-level space, a multi-segment path
 * (`platform/runbooks`) is a nested subfolder. Top-level operations keep
 * `structure.json` in sync; nested ones manipulate S3 prefixes directly. See
 * `lib/folders.ts`.
 *
 * Each request carries the target scope (`scope=shared|user` + `userId`); an
 * operation only ever touches that scope.
 *
 * GET is a read path and is never gated. Mutations are gated by
 * `FEATURE_UPLOAD` — the same flag that controls the Library surface.
 *
 *   GET    /api/folders?scope=&userId=          → nested folder tree (no personal)
 *   POST   /api/folders  { path, scope?, userId? }      create a folder
 *   PATCH  /api/folders  { from, to, scope?, userId? }  rename a folder's leaf
 *   DELETE /api/folders?path=&scope=&userId=            delete a folder + contents
 */

function handleError(err: unknown): NextResponse {
  if (err instanceof InvalidUserIdError) {
    return NextResponse.json({ detail: 'invalid userId' }, { status: 400 });
  }
  if (err instanceof SpaceError) {
    return NextResponse.json({ detail: err.message }, { status: err.status });
  }
  return NextResponse.json({ detail: 'Internal error' }, { status: 500 });
}

/** Resolve scope + userId from arbitrary string inputs (query or body). */
function resolveTarget(scope: unknown, userId: unknown): { scope: Scope; userId?: string } {
  return {
    scope: scope === 'user' ? 'user' : 'shared',
    userId: typeof userId === 'string' && userId ? userId : undefined,
  };
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const { scope, userId } = resolveTarget(params.get('scope'), params.get('userId'));

  try {
    const folders = await listFolderTree(scope, userId);
    return NextResponse.json(folders);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request) {
  const blocked = flagGuard('upload');
  if (blocked) return blocked;

  let body: { path?: unknown; scope?: unknown; userId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ detail: 'invalid JSON body' }, { status: 400 });
  }
  if (typeof body.path !== 'string') {
    return NextResponse.json({ detail: 'path is required' }, { status: 400 });
  }

  const { scope, userId } = resolveTarget(body.scope, body.userId);
  try {
    const node = await createFolder(body.path, scope, userId);
    return NextResponse.json(node, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: Request) {
  const blocked = flagGuard('upload');
  if (blocked) return blocked;

  let body: { from?: unknown; to?: unknown; scope?: unknown; userId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ detail: 'invalid JSON body' }, { status: 400 });
  }
  if (typeof body.from !== 'string' || typeof body.to !== 'string') {
    return NextResponse.json({ detail: 'from and to are required' }, { status: 400 });
  }

  const { scope, userId } = resolveTarget(body.scope, body.userId);
  try {
    const node = await renameFolder(body.from, body.to, scope, userId);
    return NextResponse.json(node);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req: Request) {
  const blocked = flagGuard('upload');
  if (blocked) return blocked;

  const params = new URL(req.url).searchParams;
  const path = params.get('path');
  if (!path) {
    return NextResponse.json({ detail: 'path query param is required' }, { status: 400 });
  }

  const { scope, userId } = resolveTarget(params.get('scope'), params.get('userId'));
  try {
    await deleteFolder(path, scope, userId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return handleError(err);
  }
}
