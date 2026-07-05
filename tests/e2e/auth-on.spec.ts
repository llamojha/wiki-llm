import { expect, test } from '@playwright/test';

/**
 * Auth gate ON (plan 029). Runs against a dedicated server booted with
 * `AUTH_MODE=oidc` (dummy issuer) — the regression guard that "the gate
 * actually gates". Asserts the gating semantics that need no IdP round-trip
 * (the full login + allowlist path is covered by unit tests). `FEATURE_SEARCH`
 * is OFF on this server so the auth-before-flag ordering is observable.
 */
test.describe('auth gate ON (AUTH_MODE=oidc)', () => {
  test('unauthenticated API returns 401 JSON, not a redirect', async ({ request }) => {
    const res = await request.get('/api/vaults', { maxRedirects: 0 });
    expect(res.status()).toBe(401);
    expect((await res.json()).detail).toContain('authentication required');
  });

  test('/api/health is exempt — 200 {ok:true} with no session', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test('auth is enforced before the feature flag (401 before 404)', async ({ request }) => {
    // FEATURE_SEARCH is OFF here. An unauthenticated caller must get 401 (auth
    // first) — never 404 — so feature existence never leaks to anonymous users.
    const res = await request.get('/api/search?q=anything', { maxRedirects: 0 });
    expect(res.status()).toBe(401);
  });

  test('unauthenticated page request redirects to the login route', async ({ request }) => {
    const res = await request.get('/', { maxRedirects: 0 });
    expect([302, 307]).toContain(res.status());
    const location = res.headers()['location'] ?? '';
    expect(location).toContain('/api/auth/login');
    expect(location).toContain('returnTo');
  });

  test('the OIDC login route is reachable without a session (exempt)', async ({ request }) => {
    // With a dummy (non-resolvable) issuer, discovery fails → 502. The point is
    // that the route is NOT gated (no 401) and exists (no 404).
    const res = await request.get('/api/auth/login', { maxRedirects: 0 });
    expect([302, 307, 500, 502]).toContain(res.status());
  });
});
