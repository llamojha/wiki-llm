import { createHash } from 'node:crypto';

import { EncryptJWT, jwtDecrypt } from 'jose';

import { BASE_PATH } from '@/lib/base-path';

/**
 * Session layer for the auth gate (plan 029) — a **stateless, encrypted
 * cookie**. There is no server-side session store (nothing added to the
 * stack), so the cookie itself carries the (allowlisted) principal's claims,
 * encrypted+authenticated with `jose` (`dir` / `A256GCM`) under a key derived
 * from `AUTH_SESSION_SECRET`. Tampering or a wrong key ⇒ decryption fails ⇒ no
 * session. The tradeoff (spec §2): **revocation = expiry**, so the TTL is kept
 * modest (12h).
 *
 * Server-only (`node:crypto` + `jose`); imported by the `/api/auth/*` handlers,
 * `requireSession()`, and `proxy.ts` — all on the Node.js runtime.
 */

export const SESSION_COOKIE = 'canopy_session';
/** Short-lived cookie holding the in-flight OIDC transaction (state/nonce/PKCE). */
export const TX_COOKIE = 'canopy_auth_tx';

/** Session lifetime. Revocation is expiry-bound (no store), so keep it modest. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h
/** OIDC round-trip must complete within this window. */
export const TX_TTL_SECONDS = 10 * 60; // 10m

/** The authenticated principal we persist. Kept minimal (spec: sub + email). */
export interface SessionClaims {
  sub: string;
  email: string | null;
  name: string | null;
}

/** In-flight OIDC transaction state, stashed before the redirect to the IdP. */
export interface AuthTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** Where to send the user after a successful login (same-origin path only). */
  returnTo: string;
}

/** Derive a 32-byte A256GCM key from the configured secret. */
function sessionKey(secret: string): Uint8Array {
  return createHash('sha256').update(secret, 'utf8').digest();
}

async function encrypt(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  return new EncryptJWT(payload)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .encrypt(sessionKey(secret));
}

async function decrypt(
  token: string,
  secret: string,
): Promise<Record<string, unknown> | null> {
  try {
    const { payload } = await jwtDecrypt(token, sessionKey(secret));
    return payload as Record<string, unknown>;
  } catch {
    // Wrong key, tampered ciphertext, or expired ⇒ no valid session.
    return null;
  }
}

export function encryptSession(claims: SessionClaims, secret: string): Promise<string> {
  return encrypt({ ...claims }, secret, SESSION_TTL_SECONDS);
}

export async function decryptSession(
  token: string | undefined,
  secret: string,
): Promise<SessionClaims | null> {
  if (!token) return null;
  const payload = await decrypt(token, secret);
  if (!payload || typeof payload.sub !== 'string') return null;
  return {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    name: typeof payload.name === 'string' ? payload.name : null,
  };
}

export function encryptTransaction(tx: AuthTransaction, secret: string): Promise<string> {
  return encrypt({ ...tx }, secret, TX_TTL_SECONDS);
}

export async function decryptTransaction(
  token: string | undefined,
  secret: string,
): Promise<AuthTransaction | null> {
  if (!token) return null;
  const p = await decrypt(token, secret);
  if (
    !p ||
    typeof p.state !== 'string' ||
    typeof p.nonce !== 'string' ||
    typeof p.codeVerifier !== 'string' ||
    typeof p.returnTo !== 'string'
  ) {
    return null;
  }
  return { state: p.state, nonce: p.nonce, codeVerifier: p.codeVerifier, returnTo: p.returnTo };
}

/** Cookie path scoped to the deployment's base path (or root). */
export const COOKIE_PATH = BASE_PATH || '/';

export interface CookieAttrs {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
}

/**
 * Cookie attributes. `Secure` is conditional on the request being HTTPS so the
 * cookie still flows over plain-HTTP localhost (dev + e2e) — a hard `Secure`
 * would silently break the local login loop. Behind a TLS-terminating proxy we
 * trust `x-forwarded-proto`.
 */
export function cookieAttrs(req: Request, maxAge: number): CookieAttrs {
  const xfProto = req.headers.get('x-forwarded-proto');
  const proto = xfProto?.split(',')[0].trim() || new URL(req.url).protocol.replace(':', '');
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: proto === 'https',
    path: COOKIE_PATH,
    maxAge,
  };
}
