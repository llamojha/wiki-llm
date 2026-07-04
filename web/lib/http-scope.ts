import { NextResponse } from 'next/server';

import {
  InvalidUserIdError,
  resolveScope,
  type ScopePaths,
  type ScopeSelector,
} from '@/lib/scope';

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
