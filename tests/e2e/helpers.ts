import type { Page, APIRequestContext } from '@playwright/test';

import { defaultSeed, type Seed } from './fixtures';

/**
 * Seed the mock S3 store via the test-only endpoint. Call this in
 * `test.beforeEach` (or at the start of a test) so each spec sees a known
 * vault state, independent of prior runs.
 *
 * `extra` lets a test add/override keys on top of the default fixture.
 */
export async function seedVault(
  request: APIRequestContext,
  extra: Seed = {},
): Promise<void> {
  const seed = { ...defaultSeed(), ...extra };
  const res = await request.post('/api/test-seed', { data: { seed } });
  if (!res.ok()) {
    throw new Error(`seed failed: ${res.status()} ${await res.text()}`);
  }
}

/** Dump the current mock store (debug helper). */
export async function dumpVault(
  request: APIRequestContext,
): Promise<Record<string, string>> {
  const res = await request.get('/api/test-seed');
  if (!res.ok()) throw new Error(`dump failed: ${res.status()}`);
  return (await res.json()) as Record<string, string>;
}

/** Open the app at the root URL and wait for the sidebar to be visible. */
export async function gotoHome(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('.sidebar').waitFor({ state: 'visible' });
}
