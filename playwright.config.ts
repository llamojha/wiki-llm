import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the Canopy e2e suite.
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
      testIgnore: /(flags-off|auth-on)\.spec\.ts/,
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
    {
      // Third server with the OIDC auth gate ON (dummy issuer). Verifies the
      // gate actually gates — 401 for API, redirect for pages, health exempt.
      name: 'auth-on',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${PORT + 2}`,
      },
      testMatch: /auth-on\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: `pnpm --filter @canopy/web exec next start --port ${PORT}`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        MOCK_S3: '1',
        VAULT_BUCKET: 'mock-bucket',
        VAULT_PREFIX: '',
        VAULT_REGION: 'us-east-1',
        VAULT_ID: 'default',
        // A placeholder ARN so POST /api/curate/start gets past its config
        // guard and reaches the overlapping-job check. No Lambda is ever
        // invoked in the 409 tests — they short-circuit before the invoke.
        CURATE_LAMBDA_ARN: 'arn:aws:lambda:eu-central-1:000000000000:function:mock-curate',
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
      command: `pnpm --filter @canopy/web exec next start --port ${PORT + 1}`,
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
    {
      command: `pnpm --filter @canopy/web exec next start --port ${PORT + 2}`,
      url: `http://127.0.0.1:${PORT + 2}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        MOCK_S3: '1',
        VAULT_BUCKET: 'mock-bucket',
        VAULT_PREFIX: '',
        VAULT_REGION: 'us-east-1',
        VAULT_ID: 'default',
        // Built-in OIDC gate ON. The issuer is a non-resolvable placeholder:
        // the smoke never completes a login (requireSession only decrypts the
        // cookie, which needs no discovery), so the gating assertions hold.
        AUTH_MODE: 'oidc',
        OIDC_ISSUER: 'https://issuer.invalid/realms/test',
        OIDC_CLIENT_ID: 'canopy-e2e',
        AUTH_SESSION_SECRET: 'e2e-auth-session-secret-abcdefghijklmnopqrst-0123',
        AUTH_ALLOWED_EMAILS: 'allowed@example.com',
        // SEARCH stays OFF so the auth-before-flag (401-before-404) ordering is
        // observable; the rest ON to prove auth gates them regardless.
        FEATURE_AGENT: 'on',
        FEATURE_UPLOAD: 'on',
        FEATURE_CURATE: 'on',
        FEATURE_REINDEX: 'on',
        FEATURE_EDITOR: 'on',
        FEATURE_SEARCH: 'off',
        FEATURE_STAR: 'on',
        FEATURE_PUBLISHING: 'on',
      },
    },
  ],
});
