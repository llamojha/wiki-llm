import { NextResponse } from 'next/server';

import {
  InvalidUserIdError,
  isValidUserId,
  resolveScope,
  type ScopePaths,
  type ScopeSelector,
} from '@/lib/scope';

/**
 * Route-boundary guard for a request-supplied `userId`, for handlers that pass
 * it to a state-mutating helper (`createSpace`, `createFolder`, …) rather than
 * straight to `resolveScope`. Returns a 400 `NextResponse` for an invalid id,
 * else `null` — mirrors `flagGuard`:
 *
 *   const bad = userIdGuard(userId);
 *   if (bad) return bad;
 *
 * Reject here, before any mutation, so a bad id never persists to
 * `structure.json`.
 */
export function userIdGuard(userId: string | undefined): NextResponse | null {
  if (userId !== undefined && !isValidUserId(userId)) {
    return NextResponse.json({ detail: 'invalid userId' }, { status: 400 });
  }
  return null;
}

/**
 * `resolveScope` for route handlers that take a request-supplied `userId`,
 * mapping an invalid id to a 400 instead of an unhandled 500.
 *
 * Mirrors `flagGuard`'s shape: the handler resolves the scope and returns
 * early when it gets a `NextResponse` back:
 *
 *   const scope = resolveScopeOr400({ scope, userId });
 *   if (scope instanceof NextResponse) return scope;
 *
 * Streaming handlers must call this BEFORE opening their `ReadableStream` so
 * the rejection is a normal JSON 400, not an error frame mid-stream.
 */
export function resolveScopeOr400(selector: ScopeSelector): ScopePaths | NextResponse {
  try {
    return resolveScope(selector);
  } catch (err) {
    if (err instanceof InvalidUserIdError) {
      return NextResponse.json({ detail: 'invalid userId' }, { status: 400 });
    }
    throw err;
  }
}
