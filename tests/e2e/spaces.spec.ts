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

  test('rejects an invalid userId without mutating structure.json', async ({ request }) => {
    const before = (await dumpVault(request))['_system/structure.json'];

    const res = await request.post('/api/spaces', {
      data: { name: 'notes', scope: 'user', userId: 'a/b' },
    });
    expect(res.status()).toBe(400);

    // The guard must run before createSpace persists anything — structure.json
    // is byte-for-byte unchanged, with no entry under the bogus user.
    const after = (await dumpVault(request))['_system/structure.json'];
    expect(after).toBe(before);
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

  test('rejects renaming a space onto a name whose prefix has content', async ({ request }) => {
    // Orphan content under `archive/` — not a declared space, so the name checks
    // pass, but plan 015's content-collision preflight must still refuse the
    // rename rather than silently merge `wiki` into it.
    await seedVault(request, { 'authored/archive/note.md': '# stray\n' });

    const res = await request.patch('/api/spaces', { data: { from: 'wiki', to: 'archive' } });
    expect(res.status()).toBe(409);

    // Nothing moved: wiki still exists, the orphan is untouched.
    const dump = await dumpVault(request);
    expect(Object.keys(dump).some((k) => k.startsWith('authored/wiki/'))).toBe(true);
    expect(dump['authored/archive/note.md']).toBe('# stray\n');
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
    await page.locator('.folder-mgr .btn.primary', { hasText: 'Create' }).click();

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
