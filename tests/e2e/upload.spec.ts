import { expect, test } from '@playwright/test';

import { dumpVault, gotoHome, seedVault } from './helpers';

/** FEATURE_UPLOAD — POST /api/upload writes the file to S3. */
test.describe('upload modal', () => {
  test.beforeEach(async ({ request }) => {
    await seedVault(request);
  });

  test('uploads a markdown file via the upload modal', async ({ page, request }) => {
    await gotoHome(page);
    await page.locator('button[title="Toggle theme"]').waitFor();
    await page.waitForTimeout(300);

    await page.locator('button[title="Upload Markdown files"]').click();
    await expect(page.locator('.upload-drop')).toBeVisible();

    // Bypass the drag affordance by writing directly to the file input.
    const fileInput = page.locator('input[type="file"][accept=".md,.markdown"]');
    await fileInput.setInputFiles({
      name: 'uploaded-doc.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Uploaded Doc\n\nFrom an e2e test.\n', 'utf-8'),
    });

    // Wait for upload to land in the mock S3 store (raw destination by default).
    await expect
      .poll(async () => {
        const dump = await dumpVault(request);
        return Object.keys(dump).some((k) => k.endsWith('uploaded-doc.md'));
      }, { timeout: 10_000 })
      .toBe(true);

    const dump = await dumpVault(request);
    const rawKey = Object.keys(dump).find((k) => k.endsWith('uploaded-doc.md'));
    expect(rawKey).toMatch(/^raw\//);
    expect(dump[rawKey!]).toContain('Uploaded Doc');
  });
});
