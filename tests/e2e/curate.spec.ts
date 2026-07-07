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
    await page.locator('button[title^="Theme"]').waitFor();
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

/**
 * Overlapping-job guard (plan 008 step 3). These hit the *real*
 * `POST /api/curate/start` route (via the `request` fixture, which bypasses
 * `page.route` mocks), asserting it refuses to start a second job while one is
 * already processing the same scope. A placeholder `CURATE_LAMBDA_ARN` is set
 * in playwright.config.ts so the route reaches the guard; no Lambda is invoked
 * because the 409 short-circuits before the invoke, and the terminal-job case
 * stops at "no raw files" before it.
 */
test.describe('curate — overlapping-job guard', () => {
  const processingJob = (id: string) => JSON.stringify({
    id,
    status: 'processing',
    space: 'wiki',
    scope: 'shared',
    total: 3,
    completed: 1,
    files: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  });

  test('refuses a second start while a job is processing (409)', async ({ request }) => {
    await seedVault(request, {
      '_system/jobs/job-active.json': processingJob('job-active'),
    });

    const res = await request.post('/api/curate/start', { data: { space: 'wiki' } });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.detail).toContain('already running');
    expect(body.jobId).toBe('job-active');
  });

  test('a terminal (done) job does not block a new start', async ({ request }) => {
    await seedVault(request, {
      '_system/jobs/job-old.json': JSON.stringify({
        id: 'job-old',
        status: 'done',
        space: 'wiki',
        scope: 'shared',
        total: 1,
        completed: 1,
        files: [],
        startedAt: '2026-05-01T00:00:00.000Z',
        completedAt: '2026-05-01T00:01:00.000Z',
        error: null,
      }),
    });

    // Passes the overlap guard, then stops at "no raw files found" (the default
    // seed has no raw/ files) — either way, not a 409.
    const res = await request.post('/api/curate/start', { data: { space: 'wiki' } });
    expect(res.status()).not.toBe(409);
    expect(res.status()).toBe(404);
  });
});
