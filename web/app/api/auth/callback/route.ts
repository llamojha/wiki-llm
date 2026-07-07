import { NextResponse } from 'next/server';

import { authConfig } from '@/lib/auth';
import { completeLogin } from '@/lib/auth-oidc';
import { readCookie } from '@/lib/auth-guard';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  TX_COOKIE,
  cookieAttrs,
  decryptTransaction,
  encryptSession,
} from '@/lib/auth-session';
import { callbackUrl, safeReturnTo } from '@/lib/auth-url';

/**
 * OIDC callback (plan 029). Exempt from the gate. Validates the transaction
 * (state + nonce + PKCE via openid-client), then mints the encrypted session
 * cookie and redirects to the stashed `returnTo`. Access control is delegated
 * to the identity provider — if a user can authenticate, they are admitted.
 * Node.js runtime.
 */
export async function GET(req: Request) {
  const cfg = authConfig();
  if (cfg.mode !== 'oidc') {
    return NextResponse.json({ detail: 'auth gate not enabled' }, { status: 404 });
  }
  if (!cfg.sessionSecret) {
    return NextResponse.json(
      { detail: 'auth gate misconfigured: AUTH_SESSION_SECRET is not set' },
      { status: 500 },
    );
  }

  const tx = await decryptTransaction(readCookie(req, TX_COOKIE), cfg.sessionSecret);
  if (!tx) {
    return NextResponse.json(
      { detail: 'login session expired or missing — restart sign-in' },
      { status: 400 },
    );
  }

  // Reconstruct the callback URL to exactly match the registered redirect_uri
  // (origin + basePath), carrying only the IdP's query (code, state, iss).
  const current = new URL(callbackUrl(req));
  current.search = new URL(req.url).search;

  let result;
  try {
    result = await completeLogin(current.href, {
      state: tx.state,
      nonce: tx.nonce,
      codeVerifier: tx.codeVerifier,
    });
  } catch (err) {
    return NextResponse.json(
      { detail: `sign-in failed: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  // Authentication successful — mint session.
  const session = await encryptSession(
    { sub: result.sub, email: result.email, name: result.name },
    cfg.sessionSecret,
  );

  const res = NextResponse.redirect(new URL(safeReturnTo(tx.returnTo), req.url));
  res.cookies.set(SESSION_COOKIE, session, cookieAttrs(req, SESSION_TTL_SECONDS));
  res.cookies.set(TX_COOKIE, '', cookieAttrs(req, 0)); // consume the transaction
  return res;
}
