import { expect, test } from '@playwright/test';

import { dumpVault, gotoHome, seedVault } from './helpers';

/** FEATURE_REINDEX — POST /api/reindex streams progress events and rewrites indexes. */
test.describe('reindex', () => {
  test.beforeEach(async ({ request }) => {
    await seedVault(request);
  });

  test('reindexing the wiki space rewrites _system/indexes/wiki.md', async ({ page, request }) => {
    await gotoHome(page);
    await page.locator('button[title="Toggle theme"]').waitFor();
    await page.waitForTimeout(300);

    // Open upload modal then switch to the Re-index tab.
    await page.locator('button[title="Re-index everything"]').click();
    await expect(page.locator('.reindex-panel')).toBeVisible();

    await page.locator('.reindex-panel button.btn.primary', { hasText: /Re-index/ }).click();

    // Wait for completion message.
    await expect(page.locator('.reindex-panel')).toContainText('Re-index complete', {
      timeout: 15_000,
    });

    const dump = await dumpVault(request);
    const wikiIndex = dump['_system/indexes/wiki.md'];
    expect(wikiIndex).toContain('onboarding');
    expect(wikiIndex).toContain('on-call');
    expect(wikiIndex).toContain('billing-service');
  });

  test('single-space reindex preserves other spaces in the master index', async ({ request }) => {
    // Two shared indexed spaces: seed a structure that declares `articles`
    // alongside the default `wiki`, plus a doc in each.
    const structure = {
      version: 3,
      roots: {
        raw: 'raw/',
        generated: 'generated/',
        authored: 'authored/',
        users: 'users/',
        system: '_system/',
      },
      defaultUser: 'default',
      users: [
        {
          id: 'default',
          label: 'My wiki',
          default: true,
          prefix: 'users/default/',
          root: 'users/default/',
          roots: {
            raw: 'users/default/raw/',
            generated: 'users/default/generated/',
            authored: 'users/default/authored/',
            system: 'users/default/_system/',
          },
          spaces: [],
        },
      ],
      spaces: [
        { name: 'wiki', label: 'Wiki', indexed: true, generated: true, authored: true },
        { name: 'articles', label: 'Articles', indexed: true, generated: true, authored: true },
        { name: 'personal', label: 'Personal', indexed: false },
      ],
      ingest: { space: 'wiki', rawPrefix: 'raw/' },
    };
    const articlesMd = `---\ntitle: Release Notes\nsource_type: authored\n---\n\n# Release Notes\n\nWhat shipped this quarter.\n`;
    await seedVault(request, {
      '_system/structure.json': JSON.stringify(structure, null, 2),
      'authored/articles/release-notes.md': articlesMd,
    });

    // Full re-index — master index must carry both space sections.
    const full = await request.post('/api/reindex', { data: {} });
    expect(full.ok()).toBeTruthy();
    await full.text(); // drain the NDJSON stream so all writes complete

    let master = (await dumpVault(request))['_system/index.md'];
    expect(master).toContain('## Wiki');
    expect(master).toContain('## Articles');

    // Re-index only the wiki space. The regression: the master index used to be
    // rebuilt from that one space, dropping the Articles section entirely.
    const single = await request.post('/api/reindex', { data: { space: 'wiki' } });
    expect(single.ok()).toBeTruthy();
    await single.text();

    master = (await dumpVault(request))['_system/index.md'];
    expect(master).toContain('## Wiki');
    expect(master).toContain('## Articles');
  });

  test('single-space user reindex preserves the implicit personal section', async ({ request }) => {
    // A user with one declared space (`notes`) alongside the implicit
    // `personal` space. The default fixture already seeds personal docs under
    // users/default/authored/personal/.
    const structure = {
      version: 3,
      roots: {
        raw: 'raw/',
        generated: 'generated/',
        authored: 'authored/',
        users: 'users/',
        system: '_system/',
      },
      defaultUser: 'default',
      users: [
        {
          id: 'default',
          label: 'My wiki',
          default: true,
          prefix: 'users/default/',
          root: 'users/default/',
          roots: {
            raw: 'users/default/raw/',
            generated: 'users/default/generated/',
            authored: 'users/default/authored/',
            system: 'users/default/_system/',
          },
          spaces: [
            { name: 'notes', label: 'Notes', indexed: true, generated: true, authored: true },
          ],
        },
      ],
      spaces: [
        { name: 'wiki', label: 'Wiki', indexed: true, generated: true, authored: true },
        { name: 'personal', label: 'Personal', indexed: false },
      ],
      ingest: { space: 'wiki', rawPrefix: 'raw/' },
    };
    const noteMd = `---\ntitle: Sprint Notes\nsource_type: authored\n---\n\n# Sprint Notes\n\nRunning notes.\n`;
    await seedVault(request, {
      '_system/structure.json': JSON.stringify(structure, null, 2),
      'users/default/_system/structure.json': JSON.stringify(structure, null, 2),
      'users/default/authored/notes/sprint.md': noteMd,
    });

    const userMaster = () => dumpVault(request).then((d) => d['users/default/_system/index.md']);

    // Full user re-index — master must carry both Notes and Personal.
    const full = await request.post('/api/reindex', { data: { scope: 'user' } });
    expect(full.ok()).toBeTruthy();
    await full.text();

    let master = await userMaster();
    expect(master).toContain('## Notes');
    expect(master).toContain('## Personal');

    // Re-index only the notes space. The regression: regenerateMasterIndex
    // dropped the implicit Personal section because it isn't a declared space.
    const single = await request.post('/api/reindex', { data: { scope: 'user', space: 'notes' } });
    expect(single.ok()).toBeTruthy();
    await single.text();

    master = await userMaster();
    expect(master).toContain('## Notes');
    expect(master).toContain('## Personal');
  });
});
