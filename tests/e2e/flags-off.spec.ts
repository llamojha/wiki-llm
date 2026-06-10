import { expect, test } from '@playwright/test';

/**
 * Verifies the `flagGuard()` short-circuit on every gated route. Runs
 * against the `flags-off` project, which starts a second Next server with
 * every FEATURE_* env var set to `off`. Each gated handler must return 404
 * with a `disabled` detail; the test would otherwise leak past the guard.
 */
test.describe('feature flags — all OFF', () => {
  const gated = [
    { method: 'POST', path: '/api/chat' },
    { method: 'POST', path: '/api/upload' },
    { method: 'POST', path: '/api/curate/start' },
    { method: 'POST', path: '/api/reindex' },
    { method: 'POST', path: '/api/docs' },
    { method: 'GET', path: '/api/search?q=anything' },
    { method: 'PATCH', path: '/api/star/authored%2Fwiki%2Fonboarding.md' },
  ];

  for (const c of gated) {
    test(`${c.method} ${c.path} returns 404 disabled`, async ({ request }) => {
      const res =
        c.method === 'POST'
          ? await request.post(c.path, { data: {} })
          : c.method === 'PATCH'
            ? await request.patch(c.path, { data: {} })
            : await request.get(c.path);
      expect(res.status()).toBe(404);
      const body = (await res.json().catch(() => ({}))) as { detail?: string };
      expect(body.detail ?? '').toMatch(/disabled/);
    });
  }

  test('read paths still respond when all features off', async ({ request }) => {
    // Doc reads aren't gated. Even with everything off the GET path should
    // 404 only because no fixtures were seeded — not because of a flag.
    const res = await request.get('/api/docs?view=recent');
    // Without flag guard `docs?view=recent` returns 200 with an empty list.
    expect(res.status()).toBe(200);
  });
});
