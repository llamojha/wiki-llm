import { expect, test } from '@playwright/test';

import { gotoHome } from './helpers';

/**
 * Managed vault mode (plan 027). Seeds a `pages/` store plus the
 * `_system/managed.json` marker so the server sniffs `managed`, then exercises
 * the mode end-to-end through the REAL routes:
 *  - the sidebar tree is assembled from frontmatter `parent_id` (a parent page
 *    is both openable and expandable), and a frontmatter-less synced file is
 *    auto-adopted by its path;
 *  - create assigns a `pg_…` id under `pages/<space>/`;
 *  - re-parent is a metadata-only edit — the S3 key does NOT change;
 *  - search finds a managed page.
 *
 * Seeds via `/api/test-seed` (REPLACE) so only the managed shape is present.
 */
const managedSeed = {
  '_system/managed.json': '{"version":1}',
  'pages/wiki/platform.md': '---\nid: pg_plat\ntitle: Platform\nspace: wiki\n---\nPlatform body',
  'pages/wiki/aws.md': '---\nid: pg_aws\ntitle: AWS\nspace: wiki\n---\nAWS body',
  'pages/wiki/lambda.md':
    '---\nid: pg_lambda\ntitle: Lambda\nspace: wiki\nparent_id: pg_plat\n---\nLambda body about pelicans',
  'notes/synced.md': '# Synced\n\nplain obsidian note',
};

test.describe('managed mode', () => {
  test.beforeEach(async ({ request }) => {
    const res = await request.post('/api/test-seed', { data: { seed: managedSeed } });
    expect(res.ok()).toBeTruthy();
  });

  test('assembles the sidebar tree from parent_id and adopts a synced file', async ({ page }) => {
    await gotoHome(page);
    // Spaces are top-level folders; the adopted out-of-band file shows its space.
    await expect(page.locator('.sidebar .tree-row .nav-row', { hasText: 'Wiki' })).toBeVisible();
    await expect(page.locator('.sidebar .tree-row .nav-row', { hasText: 'Notes' })).toBeVisible();

    // Expand Wiki → Platform (a page that is itself a parent) is visible.
    await page.locator('.sidebar .tree-row > .nav-row', { hasText: 'Wiki' }).first().click();
    await page.locator('.sidebar .tree-row .tree-children').first().waitFor({ state: 'visible' });
    await expect(
      page.locator('.sidebar .tree-children .nav-label', { hasText: /^Platform$/ }),
    ).toBeVisible();
  });

  test('serves a managed page through the always-on doc GET', async ({ request }) => {
    const res = await request.get('/api/docs/pages/wiki/lambda.md');
    expect(res.status()).toBe(200);
    const doc = (await res.json()) as { title: string };
    expect(doc.title).toBe('Lambda');
  });

  test('search finds a managed page', async ({ request }) => {
    const res = await request.get('/api/search?q=pelicans');
    expect(res.ok()).toBeTruthy();
    const results = (await res.json()) as Array<{ id: string }>;
    expect(results.some((r) => r.id === 'pages/wiki/lambda.md')).toBeTruthy();
  });

  test('create assigns a pg_ id under pages/<space>/', async ({ request }) => {
    const res = await request.post('/api/docs', {
      data: { title: 'New Idea', body: 'fresh content', folder: 'wiki' },
    });
    expect(res.status()).toBe(201);
    const created = (await res.json()) as { id: string };
    expect(created.id).toBe('pages/wiki/new-idea.md');

    const doc = await request.get(`/api/docs/${created.id}`);
    expect(doc.status()).toBe(200);
    const body = (await doc.json()) as { raw_markdown: string };
    expect(body.raw_markdown).toMatch(/id: pg_[a-z0-9]+/);
  });

  test('re-parent is a metadata edit — the key does not change', async ({ request }) => {
    const before = await request.get('/api/docs/pages/wiki/lambda.md');
    expect(before.status()).toBe(200);

    const rep = await request.post('/api/docs/reparent', {
      data: { id: 'pages/wiki/lambda.md', parentId: 'pg_aws' },
    });
    expect(rep.status()).toBe(200);

    // Same key still resolves; frontmatter parent_id updated in place.
    const after = await request.get('/api/docs/pages/wiki/lambda.md');
    expect(after.status()).toBe(200);
    const body = (await after.json()) as { raw_markdown: string };
    expect(body.raw_markdown).toContain('parent_id: pg_aws');
  });

  test('re-parent rejects a cycle (409)', async ({ request }) => {
    const rep = await request.post('/api/docs/reparent', {
      data: { id: 'pages/wiki/platform.md', parentId: 'pg_lambda' },
    });
    expect(rep.status()).toBe(409);
  });
});

/**
 * Reconcile / provenance→managed migration (plan 027 §8). Seeds a provenance
 * vault (no marker → sniffs provenance), then drives the REAL reconcile route
 * to migrate it into `pages/` and flip the vault to managed.
 */
const provenanceSeed = {
  'authored/wiki/human.md': '---\ntitle: Human Page\n---\nhuman body',
  'generated/wiki/ai.md': '---\ntitle: AI Page\nsource_type: generated\n---\nai body',
};

test.describe('managed reconcile', () => {
  test.beforeEach(async ({ request }) => {
    const res = await request.post('/api/test-seed', { data: { seed: provenanceSeed } });
    expect(res.ok()).toBeTruthy();
  });

  test('dry run reports migrations without writing', async ({ request }) => {
    const res = await request.post('/api/managed/reconcile', { data: { dryRun: true } });
    expect(res.ok()).toBeTruthy();
    const report = (await res.json()) as { migrated: unknown[]; markerWritten: boolean };
    expect(report.migrated).toHaveLength(2);
    expect(report.markerWritten).toBe(false);
    // Nothing moved: the original provenance doc is still served.
    expect((await request.get('/api/docs/authored/wiki/human.md')).status()).toBe(200);
  });

  test('a real run migrates the vault into pages/ and promotes it to managed', async ({ request }) => {
    const res = await request.post('/api/managed/reconcile', { data: { dryRun: false } });
    expect(res.ok()).toBeTruthy();
    const report = (await res.json()) as { migrated: unknown[]; markerWritten: boolean };
    expect(report.migrated).toHaveLength(2);
    expect(report.markerWritten).toBe(true);

    // Migrated pages are served from pages/ and classify by frontmatter origin.
    const ai = await request.get('/api/docs/pages/wiki/ai.md');
    expect(ai.status()).toBe(200);
    const aiBody = (await ai.json()) as { source_type: string };
    expect(aiBody.source_type).toBe('generated');
  });
});
