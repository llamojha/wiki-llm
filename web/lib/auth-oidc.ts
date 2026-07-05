import * as client from 'openid-client';

import { authConfig } from '@/lib/auth';

/**
 * OIDC client (plan 029) — thin wrapper over `openid-client@6` that is
 * **provider-agnostic across Keycloak and AWS Cognito**. Both expose a
 * standard `/.well-known/openid-configuration`, so `discovery()` drives both;
 * the one divergence is logout (Cognito omits `end_session_endpoint` and uses a
 * non-standard `/logout?client_id=&logout_uri=`), handled in `deriveLogoutUrl`.
 *
 * Server-only (Node.js runtime). Discovery is cached per issuer+client.
 */

export const OIDC_SCOPE = 'openid email profile';

let cached: { key: string; config: client.Configuration } | null = null;

async function getConfig(): Promise<client.Configuration> {
  const cfg = authConfig();
  if (!cfg.issuer || !cfg.clientId) {
    throw new Error('OIDC not configured: set OIDC_ISSUER and OIDC_CLIENT_ID');
  }
  const key = `${cfg.issuer}|${cfg.clientId}`;
  if (cached?.key === key) return cached.config;
  const config = await client.discovery(
    new URL(cfg.issuer),
    cfg.clientId,
    cfg.clientSecret ?? undefined,
  );
  cached = { key, config };
  return config;
}

/** Test-only: drop the cached discovery result. */
export function __resetOidcDiscovery(): void {
  cached = null;
}

export interface LoginRequest {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

/** Build the authorization redirect (PKCE + state + nonce) for the login start. */
export async function buildLoginRequest(redirectUri: string): Promise<LoginRequest> {
  const config = await getConfig();
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: OIDC_SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });
  return { url: url.href, state, nonce, codeVerifier };
}

export interface OidcResult {
  sub: string;
  email: string | null;
  name: string | null;
  idToken: string | null;
}

/** Exchange the callback code for tokens and extract the ID-token claims. */
export async function completeLogin(
  currentUrl: string,
  expected: { state: string; nonce: string; codeVerifier: string },
): Promise<OidcResult> {
  const config = await getConfig();
  const tokens = await client.authorizationCodeGrant(config, new URL(currentUrl), {
    pkceCodeVerifier: expected.codeVerifier,
    expectedState: expected.state,
    expectedNonce: expected.nonce,
  });
  const claims = tokens.claims();
  if (!claims || typeof claims.sub !== 'string') {
    throw new Error('OIDC callback returned no ID-token subject');
  }
  return {
    sub: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    name: typeof claims.name === 'string' ? claims.name : null,
    idToken: typeof tokens.id_token === 'string' ? tokens.id_token : null,
  };
}

/** Minimal shape of AS metadata we read for logout. */
export interface LogoutMetadata {
  end_session_endpoint?: string;
  authorization_endpoint?: string;
}

/**
 * Provider-agnostic logout URL. **Keycloak** advertises `end_session_endpoint`
 * → standard RP-initiated logout (`post_logout_redirect_uri` + `id_token_hint`).
 * **Cognito** omits it → derive `<hosted-domain>/logout?client_id=&logout_uri=`
 * from the origin of the (discovered) `authorization_endpoint`, so no host is
 * ever hardcoded. Pure function of metadata for unit-testability.
 */
export function deriveLogoutUrl(
  meta: LogoutMetadata,
  clientId: string,
  postLogoutRedirect: string,
  idToken: string | null,
): string {
  if (meta.end_session_endpoint) {
    const url = new URL(meta.end_session_endpoint);
    url.searchParams.set('post_logout_redirect_uri', postLogoutRedirect);
    url.searchParams.set('client_id', clientId);
    if (idToken) url.searchParams.set('id_token_hint', idToken);
    return url.href;
  }
  if (!meta.authorization_endpoint) {
    throw new Error('cannot derive logout URL: no end_session or authorization endpoint');
  }
  const logout = new URL('/logout', new URL(meta.authorization_endpoint).origin);
  logout.searchParams.set('client_id', clientId);
  logout.searchParams.set('logout_uri', postLogoutRedirect);
  return logout.href;
}

export async function buildLogoutUrl(
  postLogoutRedirect: string,
  idToken: string | null,
): Promise<string> {
  const config = await getConfig();
  const cfg = authConfig();
  const meta = config.serverMetadata() as LogoutMetadata;
  return deriveLogoutUrl(meta, cfg.clientId!, postLogoutRedirect, idToken);
}
