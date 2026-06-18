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

  test('user-scope folders are independent of shared', async ({ request }) => {
    // Create a folder in the user scope only.
    const res = await request.post('/api/spaces', {
      data: { name: 'notes', scope: 'user', userId: 'default' },
    });
    expect(res.status()).toBe(201);

    // It shows in the user scope listing…
    const userList = (await (await request.get('/api/spaces?scope=user&userId=default')).json()) as Array<{ name: string }>;
    expect(userList.some((s) => s.name === 'notes')).toBe(true);

    // …but not in the shared listing.
    const sharedList = (await (await request.get('/api/spaces')).json()) as Array<{ name: string }>;
    expect(sharedList.some((s) => s.name === 'notes')).toBe(false);
    expect(sharedList.some((s) => s.name === 'wiki')).toBe(true);

    // Structure: the user's own spaces carry it; shared spaces do not.
    const dump = await dumpVault(request);
    const structure = JSON.parse(dump['_system/structure.json']) as {
      spaces: Array<{ name: string }>;
      users: Array<{ id: string; spaces?: Array<{ name: string }> }>;
    };
    expect(structure.spaces.some((s) => s.name === 'notes')).toBe(false);
    const user = structure.users.find((u) => u.id === 'default');
    expect(user?.spaces?.some((s) => s.name === 'notes')).toBe(true);
  });

  test('the same folder name can exist in both scopes independently', async ({ request }) => {
    const shared = await request.post('/api/spaces', { data: { name: 'handbook' } });
    expect(shared.status()).toBe(201);
    const user = await request.post('/api/spaces', {
      data: { name: 'handbook', scope: 'user', userId: 'default' },
    });
    expect(user.status()).toBe(201);

    // Deleting the shared one leaves the user's copy intact.
    const del = await request.delete('/api/spaces?name=handbook');
    expect(del.status()).toBe(204);
    const userList = (await (await request.get('/api/spaces?scope=user&userId=default')).json()) as Array<{ name: string }>;
    expect(userList.some((s) => s.name === 'handbook')).toBe(true);
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
