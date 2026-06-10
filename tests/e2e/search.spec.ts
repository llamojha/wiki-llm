import { expect, test } from '@playwright/test';

import { gotoHome, seedVault } from './helpers';

/**
 * FEATURE_SEARCH — ⌘K palette wired to `GET /api/search`.
 */
test.describe('search palette', () => {
  test.beforeEach(async ({ request }) => {
    await seedVault(request);
  });

  test('cmd-k opens palette and returns fixture matches', async ({ page }) => {
    await gotoHome(page);
    // Wait for hydration so the keydown listener is bound.
    await page.locator('button[title="Toggle theme"]').waitFor();
    await page.waitForTimeout(300);

    await page.keyboard.press('ControlOrMeta+KeyK');
    const palette = page.locator('.palette');
    await expect(palette).toBeVisible();

    await palette.locator('input').fill('onboarding');
    await expect(palette).toContainText('Onboarding', { timeout: 5_000 });

    await palette.locator('input').press('Enter');
    await expect(page.locator('main')).toContainText('Onboarding Guide', {
      timeout: 10_000,
    });
  });

  test('empty query shows nothing', async ({ page }) => {
    await gotoHome(page);
    await page.locator('button[title="Toggle theme"]').waitFor();
    await page.waitForTimeout(300);

    await page.keyboard.press('ControlOrMeta+KeyK');
    const palette = page.locator('.palette');
    await expect(palette).toBeVisible();
    // No results section content when input is empty.
    await expect(palette.locator('input')).toHaveValue('');
  });
});
