import { expect, test } from '@playwright/test';

import { dumpVault, gotoHome, seedVault } from './helpers';

/** FEATURE_REINDEX — POST /api/reindex streams progress events and rewrites indexes. */
test.describe('reindex', () => {
  test.beforeEach(async ({ request }) => {
    await seedVault(request);
  });

  test('reindexing the wiki space rewrites _system/indexes/wiki.md', async ({ page, request }) => {
    await gotoHome(page);
    await page.locator('button[title="Toggle theme"]').waitFor();
    await page.waitForTimeout(300);

    // Open upload modal then switch to the Re-index tab.
    await page.locator('button[title="Re-index everything"]').click();
    await expect(page.locator('.reindex-panel')).toBeVisible();

    await page.locator('.reindex-panel button.btn.primary', { hasText: /Re-index space/ }).click();

    // Wait for completion message.
    await expect(page.locator('.reindex-panel')).toContainText('Re-index complete', {
      timeout: 15_000,
    });

    const dump = await dumpVault(request);
    const wikiIndex = dump['_system/indexes/wiki.md'];
    expect(wikiIndex).toContain('onboarding');
    expect(wikiIndex).toContain('on-call');
    expect(wikiIndex).toContain('billing-service');
  });
});
