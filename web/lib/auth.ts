/**
 * Auth gate — configuration surface + authorization primitives (plan 029,
 * design in `specs/auth-gate.md`).
 *
 * This module owns the *decision inputs* for the built-in OIDC gate: which mode
 * the deployment runs in, the OIDC/session config, and the deny-by-default
 * allowlist that answers "may this authenticated principal enter the portal?".
 * The session/cookie crypto and the OIDC code flow live in sibling modules
 * (added in the flow slice); this module is deliberately free of `next/server`
 * and crypto so it stays pure and unit-testable.
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
 * must not silently lock everyone out of an open portal; the deny-by-default
 * protection lives in the allowlist, which fails *closed*).
 */
export function authMode(): AuthMode {
  const raw = (process.env.AUTH_MODE ?? '').trim().toLowerCase();
  return AUTH_MODES.has(raw as AuthMode) ? (raw as AuthMode) : 'none';
}

/** Split a comma/whitespace-separated env list into trimmed, non-empty tokens. */
function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface AuthConfig {
  mode: AuthMode;
  /** OIDC discovery issuer URL (e.g. a Keycloak realm or a Cognito user pool). */
  issuer: string | null;
  clientId: string | null;
  clientSecret: string | null;
  /** Secret used to encrypt/sign the session cookie. Required in `oidc` mode. */
  sessionSecret: string | null;
  /** Deny-by-default allowlists — an IdP full of employees must not all get in. */
  allowedSubjects: string[];
  allowedEmails: string[];
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
    allowedSubjects: parseList(process.env.AUTH_ALLOWED_SUBJECTS),
    allowedEmails: parseList(process.env.AUTH_ALLOWED_EMAILS),
    proxySharedSecret: process.env.AUTH_PROXY_SHARED_SECRET?.trim() || null,
  };
}

export interface PrincipalClaims {
  sub?: string | null;
  email?: string | null;
}

/**
 * Deny-by-default authorization. Answers: is this authenticated principal on
 * the allowlist? **Authenticating is not being allowed in** — an empty/unset
 * allowlist admits NO ONE (fail closed), per the plan's STOP condition. A
 * principal is allowed iff its `sub` is in `AUTH_ALLOWED_SUBJECTS` OR its
 * `email` is in `AUTH_ALLOWED_EMAILS`. Email comparison is case-insensitive
 * (IdPs vary on canonicalization); subject comparison is exact.
 */
export function isPrincipalAllowed(
  claims: PrincipalClaims,
  config: Pick<AuthConfig, 'allowedSubjects' | 'allowedEmails'> = authConfig(),
): boolean {
  const { allowedSubjects, allowedEmails } = config;
  // Fail closed: no allowlist configured ⇒ nobody is authorized.
  if (allowedSubjects.length === 0 && allowedEmails.length === 0) return false;

  const sub = claims.sub?.trim();
  if (sub && allowedSubjects.includes(sub)) return true;

  const email = claims.email?.trim().toLowerCase();
  if (email && allowedEmails.some((e) => e.toLowerCase() === email)) return true;

  return false;
}
