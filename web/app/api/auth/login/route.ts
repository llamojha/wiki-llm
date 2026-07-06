import { NextResponse } from 'next/server';

import { authConfig } from '@/lib/auth';
import { buildLoginRequest } from '@/lib/auth-oidc';
import { TX_COOKIE, TX_TTL_SECONDS, cookieAttrs, encryptTransaction } from '@/lib/auth-session';
import { callbackUrl, safeReturnTo } from '@/lib/auth-url';

/**
 * OIDC login start (plan 029). Exempt from the gate — it *is* the way in.
 * Generates PKCE + state + nonce, stashes them (plus the sanitized `returnTo`)
 * in a short-lived encrypted transaction cookie, and redirects the browser to
 * the IdP's authorization endpoint. Works for Keycloak and Cognito alike
 * (both drive off standard discovery). Node.js runtime.
 */
export async function GET(req: Request) {
  const cfg = authConfig();
  // Only meaningful when the built-in OIDC gate is active.
  if (cfg.mode !== 'oidc') {
    return NextResponse.json({ detail: 'auth gate not enabled' }, { status: 404 });
  }
  if (!cfg.sessionSecret) {
    return NextResponse.json(
      { detail: 'auth gate misconfigured: AUTH_SESSION_SECRET is not set' },
      { status: 500 },
    );
  }

  const returnTo = safeReturnTo(new URL(req.url).searchParams.get('returnTo'));

  let login;
  try {
    login = await buildLoginRequest(callbackUrl(req));
  } catch (err) {
    // Discovery/config failure — surface clearly rather than a blank redirect.
    return NextResponse.json(
      { detail: `OIDC discovery failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  const txCookie = await encryptTransaction(
    { state: login.state, nonce: login.nonce, codeVerifier: login.codeVerifier, returnTo },
    cfg.sessionSecret,
  );

  const res = NextResponse.redirect(login.url);
  res.cookies.set(TX_COOKIE, txCookie, cookieAttrs(req, TX_TTL_SECONDS));
  return res;
}
