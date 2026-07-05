import { expect, test } from '@playwright/test';

import { gotoHome } from './helpers';

/**
 * First-class HTML documents (plan 022). Seeds a plain folder vault (folders
 * mode) with a normal HTML doc and a hostile one, then exercises the full
 * lifecycle: recognized by the listing, browsable, readable via the doc API
 * with derived metadata, searchable, and — critically — rendered INERT
 * (script/onerror stripped, no dialog). Seeds directly to keep the vault a
 * plain folder (the default fixture's structure.json would force provenance).
 */
const htmlSeed = {
  'docs/page.html':
    '<html><head><title>Pelican Facts</title></head><body><h1>Pelicans</h1><p>Pelicans are large water birds.</p><a href="docs/more.html">more</a></body></html>',
  'docs/evil.html':
    '<html><head><title>Hostile</title></head><body><p>safe body text</p><script>window.__pwned = true;</script><img src="x" onerror="window.__pwned = true"></body></html>',
};

test.describe('html documents', () => {
  test.beforeEach(async ({ request }) => {
    const res = await request.post('/api/test-seed', { data: { seed: htmlSeed } });
    expect(res.ok()).toBeTruthy();
  });

  test('serves an HTML doc with derived metadata', async ({ request }) => {
    const res = await request.get('/api/docs/docs/page.html');
    expect(res.status()).toBe(200);
    const doc = (await res.json()) as { title: string; source_type: string };
    expect(doc.title).toBe('Pelican Facts'); // from <title>
    expect(doc.source_type).toBe('uploaded');
  });

  test('search finds an HTML doc by its text', async ({ request }) => {
    const res = await request.get('/api/search?q=pelicans');
    expect(res.ok()).toBeTruthy();
    const results = (await res.json()) as Array<{ id: string }>;
    expect(results.some((r) => r.id === 'docs/page.html')).toBeTruthy();
  });

  test('uploads an HTML file as an authored document', async ({ request }) => {
    const form = {
      multipart: {
        file: { name: 'notes.html', mimeType: 'text/html', buffer: Buffer.from('<h1>Uploaded</h1>') },
        destination: 'authored',
        space: 'inbox',
      },
    } as const;
    const res = await request.post('/api/upload', form);
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { key: string };
    expect(body.key).toBe('inbox/notes.html');
  });

  test('renders a hostile HTML doc inert (no script, no dialog)', async ({ page }) => {
    let pwned = false;
    page.on('dialog', (d) => { pwned = true; void d.dismiss(); });

    await gotoHome(page);
    await page.waitForTimeout(800);

    const docsFolder = page.locator('.sidebar .tree-row > .nav-row', { hasText: 'Docs' });
    await docsFolder.click();
    await page.locator('.sidebar .tree-row .tree-children').first().waitFor({ state: 'visible' });

    const evil = page
      .locator('.sidebar .tree-children button.nav-row')
      .filter({ has: page.locator('.nav-label', { hasText: /^Evil$/ }) })
      .first();
    await evil.click();

    // Safe text renders; the script tag is gone from the rendered body.
    await expect(page.locator('.doc-body')).toContainText('safe body text', { timeout: 10_000 });
    expect(await page.locator('.doc-body script').count()).toBe(0);
    // The injected globals never executed.
    expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned ?? false)).toBe(false);
    expect(pwned).toBe(false);
  });
});
