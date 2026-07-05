import { expect, test } from '@playwright/test';

import { gotoHome } from './helpers';

/**
 * Folders-first vault mode (plan 021). Seeds a plain folder of Markdown with no
 * `_system/structure.json` and no `generated/`/`authored/` roots, so the server
 * sniffs `folders` mode. Asserts the on-ramp goal end-to-end: plain `.md` under
 * arbitrary folders is recognized, browsable, searchable, and readable — and the
 * scope toggle (a provenance/multi-tenant concept) is hidden.
 *
 * Seeds directly via `/api/test-seed` (not the `seedVault` helper) to REPLACE
 * the store with only plain folders — the default fixture ships a
 * `structure.json` that would flip the sniff to provenance.
 */
const foldersSeed = {
  'notes/hello.md': '---\ntitle: Hello Note\n---\n\nA folders-mode note about pelicans.',
  'guides/setup.md': '---\ntitle: Setup Guide\n---\n\nHow to set things up.',
};

test.describe('folders mode', () => {
  test.beforeEach(async ({ request }) => {
    const res = await request.post('/api/test-seed', { data: { seed: foldersSeed } });
    expect(res.ok()).toBeTruthy();
  });

  test('hides the scope toggle and lists top-level folders as spaces', async ({ page }) => {
    await gotoHome(page);
    // The Shared/My scope switch is a provenance/multi-tenant affordance — gone.
    await expect(page.locator('.scope-switch')).toHaveCount(0);
    // Top-level folders become the tree's spaces.
    await expect(
      page.locator('.sidebar .tree-row .nav-row', { hasText: 'Notes' }),
    ).toBeVisible();
    await expect(
      page.locator('.sidebar .tree-row .nav-row', { hasText: 'Guides' }),
    ).toBeVisible();
  });

  test('opens a plain-folder doc and renders its frontmatter title + body', async ({ page }) => {
    await gotoHome(page);
    await page.waitForTimeout(800); // let AppShell hydrate before clicking

    const notesFolder = page.locator('.sidebar .tree-row > .nav-row', { hasText: 'Notes' });
    await notesFolder.click();
    await page.locator('.sidebar .tree-row .tree-children').first().waitFor({ state: 'visible' });

    const docLink = page
      .locator('.sidebar .tree-children button.nav-row')
      .filter({ has: page.locator('.nav-label', { hasText: /^Hello$/ }) })
      .first();
    await docLink.click();

    await expect(page.locator('main')).toContainText('Hello Note', { timeout: 10_000 });
    await expect(page.locator('main')).toContainText('pelicans');
  });

  test('serves a plain-folder key through the always-on doc GET', async ({ request }) => {
    // `notes/hello.md` is outside every provenance root — recognized only
    // because folders mode widened `isDocumentKey`.
    const res = await request.get('/api/docs/notes/hello.md');
    expect(res.status()).toBe(200);
    const doc = (await res.json()) as { title: string; source_type: string };
    expect(doc.title).toBe('Hello Note');
    expect(doc.source_type).toBe('authored');
  });

  test('search finds a folders-mode document', async ({ request }) => {
    const res = await request.get('/api/search?q=pelicans');
    expect(res.ok()).toBeTruthy();
    const results = (await res.json()) as Array<{ id: string }>;
    expect(results.some((r) => r.id === 'notes/hello.md')).toBeTruthy();
  });
});
