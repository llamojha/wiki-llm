import { expect, test } from '@playwright/test';

import { defaultSeed } from './fixtures';
import { dumpVault, gotoHome, seedVault } from './helpers';

/**
 * FEATURE_EDITOR — `POST /api/docs` for create, `PUT /api/docs/[id]` for
 * update. The UI surface is the New-page button + the editor form.
 */
test.describe('editor', () => {
  test.beforeEach(async ({ request }) => {
    await seedVault(request);
  });

  test('creates a new personal page and reflects it in S3', async ({ page, request }) => {
    await gotoHome(page);
    await page.locator('button[title="Toggle theme"]').waitFor();
    await page.waitForTimeout(300);

    await page.locator('button[title="New page"]').click();
    const titleInput = page.locator('input.editor-title');
    await expect(titleInput).toBeVisible();
    await titleInput.fill('My E2E Page');

    await page.locator('button.btn.primary', { hasText: /Save/ }).click();

    // After save the editor closes and the doc appears in the tree.
    await expect(page.locator('.toast-stack')).toContainText(
      /Saved.*My E2E Page/,
      { timeout: 10_000 },
    );

    // Verify it landed in the mock store under the personal prefix.
    const dump = await dumpVault(request);
    const key = Object.keys(dump).find((k) =>
      k.startsWith('users/amllamojha/authored/personal/') && k.endsWith('my-e2e-page.md'),
    );
    expect(key).toBeTruthy();
    expect(dump[key!]).toContain('My E2E Page');
  });

  test('updates an existing personal page via PUT', async ({ page, request }) => {
    // Open Q2 planning (existing personal doc from the seed).
    await page.goto('/users%2Famllamojha%2Fauthored%2Fpersonal%2Fq2-planning.md');
    await expect(page.locator('main')).toContainText('Q2 Planning', { timeout: 10_000 });

    // Toggle into edit mode via the doc toolbar's Edit button.
    await page.locator('.doc-toolbar button.btn', { hasText: /Edit/ }).click();
    const body = page.locator('textarea.editor-input');
    await expect(body).toBeVisible();
    await body.fill('# Q2 Planning\n\nUpdated body from e2e test.\n');

    await page.locator('button.btn.primary', { hasText: /Save/ }).click();
    await expect(page.locator('.toast-stack')).toContainText(/Saved/, {
      timeout: 10_000,
    });

    const dump = await dumpVault(request);
    const content = dump['users/amllamojha/authored/personal/q2-planning.md'];
    expect(content).toContain('Updated body from e2e test');
  });

  test('rejects duplicate slug with 409', async ({ page, request }) => {
    // Pre-create a doc whose slug collides with what the editor will derive.
    const seed = defaultSeed();
    seed['users/amllamojha/authored/personal/dup-target.md'] =
      '---\ntitle: Dup Target\n---\n# Dup Target\n';
    await seedVault(request, seed);
    await gotoHome(page);
    await page.locator('button[title="Toggle theme"]').waitFor();
    await page.waitForTimeout(300);

    await page.locator('button[title="New page"]').click();
    await page.locator('input.editor-title').fill('Dup Target');
    await page.locator('button.btn.primary', { hasText: /Save/ }).click();
    await expect(page.locator('.toast-stack')).toContainText(/already exists/, {
      timeout: 10_000,
    });
  });
});
