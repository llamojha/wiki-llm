import { expect, test } from '@playwright/test';

import { gotoHome, seedVault } from './helpers';

/**
 * Always-on read paths: home view renders, sidebar shows fixtures, clicking
 * a doc renders DocReader with the document title and body, theme toggle
 * persists. None of these are flag-gated.
 */

test.describe('read paths', () => {
  test.beforeEach(async ({ request }) => {
    await seedVault(request);
  });

  test('home view + sidebar lists fixture spaces', async ({ page }) => {
    await gotoHome(page);
    await expect(page.locator('main')).toBeVisible();

    // The Wiki folder is rendered as a `.nav-row` in the sidebar tree (not the
    // "My wiki" scope-switch button). Match by structure to avoid ambiguity.
    const wikiFolder = page.locator('.sidebar .tree-row .nav-row', { hasText: 'Wiki' });
    await expect(wikiFolder).toBeVisible();
  });

  test('opens an authored doc and renders title + body', async ({ page }) => {
    await gotoHome(page);
    // Give React time to hydrate the AppShell. Without this, the click
    // below dispatches before the onClick handler is attached, leaving
    // the folder collapsed and the doc link invisible.
    await page.waitForTimeout(800);

    const wikiFolder = page.locator('.sidebar .tree-row > .nav-row', { hasText: 'Wiki' });
    await wikiFolder.click();
    await page.locator('.sidebar .tree-row .tree-children').first().waitFor({ state: 'visible' });

    const docLink = page
      .locator('.sidebar .tree-children button.nav-row')
      .filter({ has: page.locator('.nav-label', { hasText: /^Onboarding$/ }) })
      .first();
    await docLink.click();

    await expect(page.locator('main')).toContainText('Onboarding Guide', { timeout: 10_000 });
    await expect(page.locator('main')).toContainText('first-week checklist');
  });

  test('theme toggle switches data-theme', async ({ page }) => {
    await gotoHome(page);
    // Wait for hydration — the topbar button needs its onClick attached.
    await page.locator('.topbar').waitFor({ state: 'visible' });
    const html = page.locator('html');
    const initial = (await html.getAttribute('data-theme')) ?? 'dark';

    const toggle = page.locator('button[title="Toggle theme"]');
    await toggle.waitFor({ state: 'visible' });
    // Hydration races the click here. Wait a beat for React to attach the
    // onClick handler — once attached, `.click()` triggers the toggle.
    await page.waitForTimeout(300);
    await toggle.click();
    await expect
      .poll(async () => html.getAttribute('data-theme'), { timeout: 5000 })
      .not.toBe(initial);
  });
});
