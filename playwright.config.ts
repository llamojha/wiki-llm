import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the Vaultmark e2e suite.
 *
 * Drives the real Next.js app with `MOCK_S3=1` so every feature flows
 * through actual route handlers backed by the in-memory mock store.
 * AWS-dependent features that don't have a mock backend (Bedrock chat,
 * Lambda curate) are intercepted per-test via `page.route` instead.
 *
 * Run with: `pnpm test:e2e`
 */
const PORT = Number(process.env.E2E_PORT ?? 3030);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // mock S3 state is per-process and shared across requests
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /flags-off\.spec\.ts/,
    },
    {
      // Second server with every gated feature toggled OFF — exercises the
      // `flagGuard()` short-circuit on each route.
      name: 'flags-off',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${PORT + 1}`,
      },
      testMatch: /flags-off\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: `pnpm --filter @vaultmark/web exec next start --port ${PORT}`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        MOCK_S3: '1',
        VAULT_BUCKET: 'mock-bucket',
        VAULT_PREFIX: '',
        VAULT_REGION: 'us-east-1',
        VAULT_ID: 'default',
        // The default code profile ships most features OFF (see lib/flags.ts).
        // The e2e suite exercises every feature, so turn them all ON here.
        FEATURE_AGENT: 'on',
        FEATURE_UPLOAD: 'on',
        FEATURE_CURATE: 'on',
        FEATURE_REINDEX: 'on',
        FEATURE_EDITOR: 'on',
        FEATURE_SEARCH: 'on',
        FEATURE_STAR: 'on',
        FEATURE_PUBLISHING: 'on',
      },
    },
    {
      command: `pnpm --filter @vaultmark/web exec next start --port ${PORT + 1}`,
      url: `http://127.0.0.1:${PORT + 1}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        MOCK_S3: '1',
        VAULT_BUCKET: 'mock-bucket',
        VAULT_PREFIX: '',
        VAULT_REGION: 'us-east-1',
        VAULT_ID: 'default',
        FEATURE_AGENT: 'off',
        FEATURE_UPLOAD: 'off',
        FEATURE_CURATE: 'off',
        FEATURE_REINDEX: 'off',
        FEATURE_EDITOR: 'off',
        FEATURE_SEARCH: 'off',
        FEATURE_STAR: 'off',
        FEATURE_PUBLISHING: 'off',
      },
    },
  ],
});
