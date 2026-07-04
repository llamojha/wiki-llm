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
    // GET /api/spaces and GET /api/folders are read paths and never gated
    // (see the route docs) — only their mutations are. GET was listed here by
    // mistake; folders' GET was already correctly excluded.
    { method: 'POST', path: '/api/spaces' },
    { method: 'PATCH', path: '/api/spaces' },
    { method: 'DELETE', path: '/api/spaces?name=anything' },
    { method: 'POST', path: '/api/folders' },
    { method: 'PATCH', path: '/api/folders' },
    { method: 'DELETE', path: '/api/folders?path=anything' },
  ];

  for (const c of gated) {
    test(`${c.method} ${c.path} returns 404 disabled`, async ({ request }) => {
      const res =
        c.method === 'POST'
          ? await request.post(c.path, { data: {} })
          : c.method === 'PATCH'
            ? await request.patch(c.path, { data: {} })
            : c.method === 'DELETE'
              ? await request.delete(c.path)
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

  test('GET /api/spaces is a read path — not gated by FEATURE_UPLOAD', async ({ request }) => {
    // Listing a scope's spaces stays browsable with upload off; only the
    // mutations (POST/PATCH/DELETE) are gated. The route documents this as
    // "GET is a read path and is never gated".
    const res = await request.get('/api/spaces');
    expect(res.status()).toBe(200);
  });
});
