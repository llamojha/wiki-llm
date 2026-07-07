/**
 * Auth gate — configuration surface (plan 029, design in `specs/auth-gate.md`).
 *
 * This module owns the *decision inputs* for the built-in OIDC gate: which mode
 * the deployment runs in and the OIDC/session config. The session/cookie crypto
 * and the OIDC code flow live in sibling modules; this module is deliberately
 * free of `next/server` and crypto so it stays pure and unit-testable.
 *
 * Access control is delegated to the identity provider (Cognito User Pool):
 * if a user can authenticate, they are admitted. There is no application-level
 * allowlist.
 *
 * Modes (`AUTH_MODE`, default **`none`**):
 *   - `none`  — no gate. Exactly today's open portal. **Load-bearing**: the
 *               entire e2e suite and every existing deployment depend on this
 *               being the default when `AUTH_MODE` is unset.
 *   - `oidc`  — built-in OIDC code flow + encrypted session cookie (self-host
 *               first-class path). v1.
 *   - `proxy` — trust an upstream gate's `X-Forwarded-User`, but ONLY when a
 *               shared secret matches. v2 (parsed here, enforced later).
 *
 * Secrets are env-only (never in the repo); the shape is documented in
 * `docs/configuration.md`.
 */

export type AuthMode = 'none' | 'oidc' | 'proxy';

const AUTH_MODES = new Set<AuthMode>(['none', 'oidc', 'proxy']);

/**
 * Resolved auth mode. Unknown/empty ⇒ `none` (fail *open* on config typo is the
 * intended behavior for the *mode selector* only — a misspelled `AUTH_MODE`
 * must not silently lock everyone out of an open portal).
 */
export function authMode(): AuthMode {
  const raw = (process.env.AUTH_MODE ?? '').trim().toLowerCase();
  return AUTH_MODES.has(raw as AuthMode) ? (raw as AuthMode) : 'none';
}

export interface AuthConfig {
  mode: AuthMode;
  /** OIDC discovery issuer URL (e.g. a Keycloak realm or a Cognito user pool). */
  issuer: string | null;
  clientId: string | null;
  clientSecret: string | null;
  /** Secret used to encrypt/sign the session cookie. Required in `oidc` mode. */
  sessionSecret: string | null;
  /** Shared secret an upstream proxy must present in `proxy` mode. */
  proxySharedSecret: string | null;
}

/** Read the full auth config from the environment (call per-request; cheap). */
export function authConfig(): AuthConfig {
  return {
    mode: authMode(),
    issuer: process.env.OIDC_ISSUER?.trim() || null,
    clientId: process.env.OIDC_CLIENT_ID?.trim() || null,
    clientSecret: process.env.OIDC_CLIENT_SECRET?.trim() || null,
    sessionSecret: process.env.AUTH_SESSION_SECRET?.trim() || null,
    proxySharedSecret: process.env.AUTH_PROXY_SHARED_SECRET?.trim() || null,
  };
}
