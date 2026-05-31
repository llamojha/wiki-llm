import { expect, test } from '@playwright/test';

import { gotoHome, seedVault } from './helpers';

/**
 * FEATURE_AGENT — POST /api/chat (NDJSON stream of AgentEvents).
 *
 * The real route hits Bedrock; we mock it at the network layer so the test
 * exercises the chat panel UI end-to-end without an AWS round trip.
 */
test.describe('ask-wiki chat', () => {
  test.beforeEach(async ({ request, page }) => {
    await seedVault(request);
    await page.route('**/api/chat', async (route) => {
      const events = [
        { type: 'text', delta: 'The on-call procedure is to ' },
        { type: 'text', delta: 'acknowledge within five minutes.' },
        {
          type: 'cite',
          id: 'authored/wiki/on-call.md',
          title: 'On-Call Runbook',
          section: 'Paging',
        },
        { type: 'done' },
      ];
      const body = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
        body,
      });
    });
  });

  test('opens chat, submits a prompt, streams the canned reply', async ({ page }) => {
    await gotoHome(page);
    await page.locator('button[title="Toggle theme"]').waitFor();
    await page.waitForTimeout(300);

    // Open chat via the FAB.
    await page.locator('button.chat-fab').click();
    await expect(page.locator('.chat-panel')).toBeVisible();

    const ta = page.locator('.chat-input textarea');
    await ta.fill('What is the on-call procedure?');
    await page.locator('.chat-input button.btn.primary', { hasText: /Send/ }).click();

    // The streamed text from our mock should land in the latest assistant bubble.
    await expect(page.locator('.chat-body')).toContainText('acknowledge within five minutes', {
      timeout: 10_000,
    });
    // Citation rendered.
    await expect(page.locator('.chat-body')).toContainText('On-Call Runbook');
  });
});
