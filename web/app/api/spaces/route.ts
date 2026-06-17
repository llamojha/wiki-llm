import { NextResponse } from 'next/server';

import { flagGuard } from '@/lib/flags';
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
 * Gated by `FEATURE_UPLOAD` — the same flag that controls the Library upload
 * surface, since folder management lives alongside it in the modal. All
 * operations are vault-global (shared + every declared user scope); see
 * `lib/spaces.ts`.
 *
 *   GET    /api/spaces           → list declared spaces (excludes personal)
 *   POST   /api/spaces           → { name }        create a space
 *   PATCH  /api/spaces           → { from, to }    rename a space
 *   DELETE /api/spaces?name=...  → delete a space and all its content
 */

function handleError(err: unknown): NextResponse {
  if (err instanceof SpaceError) {
    return NextResponse.json({ detail: err.message }, { status: err.status });
  }
  return NextResponse.json({ detail: 'Internal error' }, { status: 500 });
}

export async function GET() {
  const blocked = flagGuard('upload');
  if (blocked) return blocked;

  const spaces = await listSpaces();
  return NextResponse.json(spaces);
}

export async function POST(req: Request) {
  const blocked = flagGuard('upload');
  if (blocked) return blocked;

  let name: unknown;
  try {
    ({ name } = (await req.json()) as { name?: unknown });
  } catch {
    return NextResponse.json({ detail: 'invalid JSON body' }, { status: 400 });
  }
  if (typeof name !== 'string') {
    return NextResponse.json({ detail: 'name is required' }, { status: 400 });
  }

  try {
    const entry = await createSpace(name);
    return NextResponse.json(entry, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: Request) {
  const blocked = flagGuard('upload');
  if (blocked) return blocked;

  let from: unknown;
  let to: unknown;
  try {
    ({ from, to } = (await req.json()) as { from?: unknown; to?: unknown });
  } catch {
    return NextResponse.json({ detail: 'invalid JSON body' }, { status: 400 });
  }
  if (typeof from !== 'string' || typeof to !== 'string') {
    return NextResponse.json({ detail: 'from and to are required' }, { status: 400 });
  }

  try {
    const entry = await renameSpace(from, to);
    return NextResponse.json(entry);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req: Request) {
  const blocked = flagGuard('upload');
  if (blocked) return blocked;

  const name = new URL(req.url).searchParams.get('name');
  if (!name) {
    return NextResponse.json({ detail: 'name query param is required' }, { status: 400 });
  }

  try {
    await deleteSpace(name);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return handleError(err);
  }
}
