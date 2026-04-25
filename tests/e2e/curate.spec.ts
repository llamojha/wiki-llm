import { expect, test } from '@playwright/test';

import { gotoHome, seedVault } from './helpers';

/**
 * FEATURE_CURATE — the curate flow uses an AWS Lambda for batch processing,
 * which we can't run locally. Mock `/api/curate/*` at the network layer
 * (and `/api/raw` for the pending count) so the UI flow is exercised end-to-end
 * against a deterministic backend.
 */
test.describe('curate (process pending)', () => {
  test.beforeEach(async ({ request, page }) => {
    await seedVault(request);

    // /api/raw reports the pending count. Pretend there's one raw file.
    await page.route('**/api/raw**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          space: 'wiki',
          count: 1,
          keys: ['raw/pending-file.md'],
          total: 1,
          scope: 'shared',
        }),
      });
    });

    // start → return a fake jobId.
    await page.route('**/api/curate/start', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ jobId: 'job-e2e-1', space: 'wiki', total: 1 }),
      });
    });

    // status → return a single completed file (status 'done'). One call is
    // enough; the UI keeps polling until status becomes 'completed'.
    await page.route('**/api/curate/status**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jobId: 'job-e2e-1',
          status: 'completed',
          total: 1,
          completed: 1,
          files: [
            {
              key: 'raw/pending-file.md',
              status: 'done',
              startedAt: '2026-05-30T12:00:00.000Z',
              finishedAt: '2026-05-30T12:00:01.200Z',
            },
          ],
        }),
      });
    });

    await page.route('**/api/curate/finalize', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });
  });

  test('runs a mocked batch to completion', async ({ page }) => {
    await gotoHome(page);
    await page.locator('button[title="Toggle theme"]').waitFor();
    await page.waitForTimeout(300);

    await page.locator('button[title="Curate raw files in S3"]').click();
    await expect(page.locator('.pending-summary')).toBeVisible();

    const startBtn = page.locator('.upload-foot button.btn.primary', {
      hasText: /Process batch/,
    });
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    // After the mocked status loop converges, the line should report indexed.
    await expect(page.locator('.pending-stream')).toContainText('pending-file.md', {
      timeout: 15_000,
    });
  });
});
