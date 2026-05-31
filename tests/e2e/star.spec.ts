import { expect, test } from '@playwright/test';

import { dumpVault, seedVault } from './helpers';

/** FEATURE_STAR — PATCH /api/star/[id] toggles starred frontmatter. */
test.describe('star toggle', () => {
  test.beforeEach(async ({ request }) => {
    await seedVault(request);
  });

  test('clicking star button flips the frontmatter flag', async ({ page, request }) => {
    await page.goto('/authored%2Fwiki%2Fon-call.md');
    await expect(page.locator('main')).toContainText('On-Call Runbook', {
      timeout: 10_000,
    });
    await page.waitForTimeout(300);

    // Star button — title flips between "Star" and "Unstar".
    const star = page.locator('.doc-toolbar button[title="Star"]');
    await star.waitFor();
    await star.click();

    // Optimistic update flips title immediately.
    await expect(page.locator('.doc-toolbar button[title="Unstar"]')).toBeVisible({
      timeout: 5_000,
    });

    // S3-mock side: frontmatter now has starred: true.
    await page.waitForTimeout(400);
    const dump = await dumpVault(request);
    const md = dump['authored/wiki/on-call.md'];
    expect(md).toMatch(/starred:\s*true/);
  });
});
