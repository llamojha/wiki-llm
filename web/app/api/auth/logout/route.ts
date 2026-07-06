import { NextResponse } from 'next/server';

import { authConfig } from '@/lib/auth';
import { buildLogoutUrl } from '@/lib/auth-oidc';
import { SESSION_COOKIE, cookieAttrs } from '@/lib/auth-session';
import { APP_ROOT, requestBaseUrl } from '@/lib/auth-url';

/**
 * Logout (plan 029). Exempt from the gate. Always clears the local session
 * cookie, then best-effort redirects to the IdP's end-session endpoint so the
 * IdP session is dropped too — standard RP-initiated logout for Keycloak, the
 * non-standard `/logout?client_id=&logout_uri=` for Cognito (see
 * `deriveLogoutUrl`). If discovery/IdP logout can't be built, we still clear
 * the cookie and land the user back at the app root. Node.js runtime.
 */
async function handle(req: Request) {
  const cfg = authConfig();
  const home = new URL(APP_ROOT, req.url);

  let redirectTo: URL = home;
  if (cfg.mode === 'oidc' && cfg.issuer) {
    const postLogout = `${requestBaseUrl(req)}${APP_ROOT === '/' ? '' : APP_ROOT}/`;
    try {
      redirectTo = new URL(await buildLogoutUrl(postLogout, null));
    } catch {
      // Discovery/IdP logout unavailable — local cookie clear is still enough
      // to end the portal session; fall back to the app root.
      redirectTo = home;
    }
  }

  const res = NextResponse.redirect(redirectTo);
  res.cookies.set(SESSION_COOKIE, '', cookieAttrs(req, 0));
  return res;
}

export const GET = handle;
export const POST = handle;
