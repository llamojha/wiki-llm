import { NextResponse } from 'next/server';

import { authConfig, isPrincipalAllowed } from '@/lib/auth';
import { SESSION_COOKIE, decryptSession, type SessionClaims } from '@/lib/auth-session';

/**
 * Auth enforcement (plan 029) — the **real gate**. `proxy.ts` redirects
 * unauthenticated page loads for UX, but handlers are directly reachable, so
 * every gated `/api/*` handler calls `requireSession(req)` (mirroring
 * `flagGuard`). Ordering in handlers is **auth before flag**: call
 * `requireSession` first so an unauthenticated caller gets a 401 before a
 * disabled feature's 404 — never leaking which features exist.
 *
 * Server-only (`next/server` + session crypto), Node.js runtime.
 */

/** Parse a single cookie value out of the request's `Cookie` header. */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/** Decrypt the session cookie into claims, or `null` if absent/invalid. */
export async function getSession(req: Request): Promise<SessionClaims | null> {
  const cfg = authConfig();
  if (!cfg.sessionSecret) return null;
  return decryptSession(readCookie(req, SESSION_COOKIE), cfg.sessionSecret);
}

/**
 * API-handler gate. Returns:
 *   - `null` when the request may proceed (mode `none`, or a valid+allowlisted
 *     session);
 *   - a `401` when a session is required but missing/invalid;
 *   - a `403` when authenticated but not on the allowlist (re-checked every
 *     request, so removing a principal takes effect immediately);
 *   - a `500` when the gate is misconfigured (mode `oidc` without a secret) —
 *     fail closed rather than silently open.
 */
export async function requireSession(req: Request): Promise<NextResponse | null> {
  const cfg = authConfig();
  if (cfg.mode === 'none') return null;
  if (!cfg.sessionSecret) {
    return NextResponse.json(
      { detail: 'auth gate misconfigured: AUTH_SESSION_SECRET is not set' },
      { status: 500 },
    );
  }
  const claims = await getSession(req);
  if (!claims) {
    return NextResponse.json({ detail: 'authentication required' }, { status: 401 });
  }
  if (!isPrincipalAllowed(claims, cfg)) {
    return NextResponse.json({ detail: 'not authorized for this portal' }, { status: 403 });
  }
  return null;
}

/**
 * Boolean authorization used by `proxy.ts` for page requests (it redirects
 * rather than returning JSON). `true` ⇒ let the page render.
 */
export async function isRequestAuthorized(req: Request): Promise<boolean> {
  const cfg = authConfig();
  if (cfg.mode === 'none') return true;
  if (!cfg.sessionSecret) return false;
  const claims = await getSession(req);
  return !!claims && isPrincipalAllowed(claims, cfg);
}
