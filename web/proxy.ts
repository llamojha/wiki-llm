import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { authConfig } from '@/lib/auth';
import { isRequestAuthorized } from '@/lib/auth-guard';
import { BASE_PATH } from '@/lib/base-path';

/**
 * Auth gate — page layer (plan 029). Next.js 16 renamed `middleware` →
 * `proxy` (Node.js runtime). This handles the **UX** of the gate: an
 * unauthenticated browser hitting a page is redirected to the login route with
 * a `returnTo`. It is deliberately NOT the security boundary — API handlers
 * self-guard via `requireSession()` (Vercel's own guidance: a matcher change
 * can silently drop proxy coverage, so never rely on it alone). When
 * `AUTH_MODE=none` the proxy is a no-op, so today's open portal is unchanged.
 *
 * The matcher excludes `/api/*` (handlers self-guard; the OIDC routes live
 * here and must stay reachable), Next internals, and common static assets.
 * Phase 9's public `/p/*` pages are page routes — when they land, add them to
 * the exclusion so they stay anonymous.
 */
export async function proxy(req: NextRequest) {
  if (authConfig().mode === 'none') return NextResponse.next();
  if (await isRequestAuthorized(req)) return NextResponse.next();

  const returnTo = req.nextUrl.pathname + req.nextUrl.search;
  const loginUrl = new URL(`${BASE_PATH}/api/auth/login`, req.url);
  loginUrl.searchParams.set('returnTo', returnTo);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Everything except API routes (self-guarded), Next internals, and static
    // assets. `p/` is Phase 9 public content — add here when it exists.
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
