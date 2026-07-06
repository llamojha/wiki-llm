import { BASE_PATH } from '@/lib/base-path';

/**
 * URL helpers for the auth routes (plan 029). Kept pure so the open-redirect
 * guard is unit-testable.
 */

/** The app root under the deployment's base path (e.g. `/wiki` or `/`). */
export const APP_ROOT = BASE_PATH || '/';

/**
 * Reconstruct the externally-visible origin, honoring a TLS-terminating proxy's
 * `x-forwarded-proto`/`x-forwarded-host` (the OIDC redirect_uri must match what
 * the browser sees, not the internal host).
 */
export function requestBaseUrl(req: Request): string {
  const url = new URL(req.url);
  const proto =
    req.headers.get('x-forwarded-proto')?.split(',')[0].trim() ||
    url.protocol.replace(':', '');
  const host =
    req.headers.get('x-forwarded-host')?.split(',')[0].trim() ||
    req.headers.get('host') ||
    url.host;
  return `${proto}://${host}`;
}

/** The full callback URL registered at the IdP (`<origin><basePath>/api/auth/callback`). */
export function callbackUrl(req: Request): string {
  return `${requestBaseUrl(req)}${BASE_PATH}/api/auth/callback`;
}

/**
 * Open-redirect guard for the post-login `returnTo`. Only a **same-origin
 * absolute path** is allowed; anything else (absolute URL, protocol-relative
 * `//evil.com`, backslash tricks) falls back to the app root. This stops an
 * attacker from crafting a login link that bounces the user to a hostile site.
 */
export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw) return APP_ROOT;
  if (!raw.startsWith('/')) return APP_ROOT; // must be a path, not an absolute URL
  if (raw.startsWith('//') || raw.startsWith('/\\')) return APP_ROOT; // protocol-relative
  return raw;
}
