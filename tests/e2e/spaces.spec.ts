import { expect, test } from '@playwright/test';

import { dumpVault, gotoHome, seedVault } from './helpers';

/**
 * FEATURE_UPLOAD — folder (space) management via the Library modal's Folders
 * tab and the backing /api/spaces route. Create declares a space in
 * structure.json; rename re-keys content across scopes; delete removes a space
 * and all its documents.
 */
test.describe('folder management', () => {
  test.beforeEach(async ({ request }) => {
    await seedVault(request);
  });

  test('creates a space via POST /api/spaces', async ({ request }) => {
    const res = await request.post('/api/spaces', { data: { name: 'handbook' } });
    expect(res.status()).toBe(201);
    const entry = (await res.json()) as { name: string; label: string };
    expect(entry.name).toBe('handbook');

    const dump = await dumpVault(request);
    const structure = JSON.parse(dump['_system/structure.json']) as {
      spaces: Array<{ name: string }>;
    };
    expect(structure.spaces.some((s) => s.name === 'handbook')).toBe(true);
  });

  test('rejects an invalid / reserved space name', async ({ request }) => {
    const bad = await request.post('/api/spaces', { data: { name: 'Not Valid!' } });
    expect(bad.status()).toBe(400);

    const reserved = await request.post('/api/spaces', { data: { name: 'personal' } });
    expect(reserved.status()).toBe(400);
  });

  test('rejects creating a duplicate space', async ({ request }) => {
    const res = await request.post('/api/spaces', { data: { name: 'wiki' } });
    expect(res.status()).toBe(409);
  });

  test('renames a space and re-keys its documents', async ({ request }) => {
    const res = await request.patch('/api/spaces', { data: { from: 'wiki', to: 'knowledge' } });
    expect(res.status()).toBe(200);

    const dump = await dumpVault(request);
    const keys = Object.keys(dump);
    expect(keys.some((k) => k.startsWith('authored/knowledge/'))).toBe(true);
    expect(keys.some((k) => k.startsWith('authored/wiki/'))).toBe(false);

    const structure = JSON.parse(dump['_system/structure.json']) as {
      spaces: Array<{ name: string }>;
    };
    expect(structure.spaces.some((s) => s.name === 'knowledge')).toBe(true);
    expect(structure.spaces.some((s) => s.name === 'wiki')).toBe(false);
  });

  test('deletes a space and all of its content', async ({ request }) => {
    const res = await request.delete('/api/spaces?name=wiki');
    expect(res.status()).toBe(204);

    const dump = await dumpVault(request);
    const keys = Object.keys(dump);
    expect(keys.some((k) => k.startsWith('authored/wiki/'))).toBe(false);
    expect(keys.some((k) => k.startsWith('generated/wiki/'))).toBe(false);

    const structure = JSON.parse(dump['_system/structure.json']) as {
      spaces: Array<{ name: string }>;
    };
    expect(structure.spaces.some((s) => s.name === 'wiki')).toBe(false);
  });

  test('refuses to delete the personal space', async ({ request }) => {
    const res = await request.delete('/api/spaces?name=personal');
    expect(res.status()).toBe(400);
  });

  test('creates a folder through the Folders tab UI', async ({ page, request }) => {
    await gotoHome(page);
    await page.locator('button[title="Toggle theme"]').waitFor();
    await page.waitForTimeout(300);

    await page.locator('button[title="Manage folders"]').click();
    await expect(page.locator('.upload-tab', { hasText: 'Folders' })).toBeVisible();

    await page.locator('input.upload-input').first().fill('playbooks');
    await page.locator('.upload-meta .btn.primary', { hasText: 'Create' }).click();

    await expect
      .poll(async () => {
        const dump = await dumpVault(request);
        const structure = JSON.parse(dump['_system/structure.json']) as {
          spaces: Array<{ name: string }>;
        };
        return structure.spaces.some((s) => s.name === 'playbooks');
      }, { timeout: 10_000 })
      .toBe(true);
  });
});
