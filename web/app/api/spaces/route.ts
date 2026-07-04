import { NextResponse } from 'next/server';

import { flagGuard } from '@/lib/flags';
import { InvalidUserIdError, type Scope } from '@/lib/scope';
import {
  SpaceError,
  createSpace,
  deleteSpace,
  listSpaces,
  renameSpace,
} from '@/lib/spaces';

/**
 * Space (folder) management.
 *
 * Spaces are per-scope: shared spaces live in `structure.spaces`, each user's
 * own spaces under `users[].spaces`. Every request carries the target scope
 * (`scope=shared|user` + `userId`); an operation only touches that scope. See
 * `lib/spaces.ts`.
 *
 * GET is a read path and is never gated. Mutations are gated by
 * `FEATURE_UPLOAD` — the same flag that controls the Library surface where
 * folder management lives.
 *
 *   GET    /api/spaces?scope=&userId=   → list a scope's spaces (no personal)
 *   POST   /api/spaces  { name, scope?, userId? }        create a space
 *   PATCH  /api/spaces  { from, to, scope?, userId? }    rename a space
 *   DELETE /api/spaces?name=&scope=&userId=              delete a space
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
    const spaces = await listSpaces(scope, userId);
    return NextResponse.json(spaces);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request) {
  const blocked = flagGuard('upload');
  if (blocked) return blocked;

  let body: { name?: unknown; scope?: unknown; userId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ detail: 'invalid JSON body' }, { status: 400 });
  }
  if (typeof body.name !== 'string') {
    return NextResponse.json({ detail: 'name is required' }, { status: 400 });
  }

  const { scope, userId } = resolveTarget(body.scope, body.userId);
  try {
    const entry = await createSpace(body.name, scope, userId);
    return NextResponse.json(entry, { status: 201 });
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
    const entry = await renameSpace(body.from, body.to, scope, userId);
    return NextResponse.json(entry);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req: Request) {
  const blocked = flagGuard('upload');
  if (blocked) return blocked;

  const params = new URL(req.url).searchParams;
  const name = params.get('name');
  if (!name) {
    return NextResponse.json({ detail: 'name query param is required' }, { status: 400 });
  }

  const { scope, userId } = resolveTarget(params.get('scope'), params.get('userId'));
  try {
    await deleteSpace(name, scope, userId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return handleError(err);
  }
}
