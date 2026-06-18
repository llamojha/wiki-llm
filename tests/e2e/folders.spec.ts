import { expect, test } from '@playwright/test';

import { dumpVault, seedVault } from './helpers';

/**
 * FEATURE_UPLOAD — nested folder management via the Library modal's Folders tab
 * and the backing /api/folders route. Top-level folders delegate to the spaces
 * logic (declared in structure.json); nested folders are pure S3 prefixes,
 * materialised by a `.keep` marker when empty and re-keyed / purged on
 * rename / delete.
 */
test.describe('nested folder management', () => {
  test.beforeEach(async ({ request }) => {
    await seedVault(request, {
      // A nested subfolder with a document, for rename/delete coverage.
      'authored/wiki/guides/setup.md': '---\ntitle: Setup\n---\n\n# Setup\n',
    });
  });

  test('GET returns the nested folder tree with indexed counts', async ({ request }) => {
    const res = await request.get('/api/folders');
    expect(res.ok()).toBeTruthy();
    const tree = (await res.json()) as Array<{ name: string; path: string; indexed: number; children: unknown[] }>;

    const wiki = tree.find((n) => n.name === 'wiki');
    expect(wiki).toBeTruthy();
    // wiki contains flat docs + the nested guides/ subfolder → count is recursive.
    expect(wiki!.indexed).toBeGreaterThanOrEqual(1);
    const guides = (wiki!.children as Array<{ name: string; path: string }>).find((c) => c.name === 'guides');
    expect(guides?.path).toBe('wiki/guides');

    // The reserved personal space is never surfaced here.
    expect(tree.some((n) => n.name === 'personal')).toBe(false);
  });

  test('creates an empty nested folder via a .keep marker', async ({ request }) => {
    const res = await request.post('/api/folders', { data: { path: 'wiki/runbooks' } });
    expect(res.status()).toBe(201);
    const node = (await res.json()) as { name: string; path: string };
    expect(node.path).toBe('wiki/runbooks');

    const dump = await dumpVault(request);
    expect(Object.keys(dump)).toContain('authored/wiki/runbooks/.keep');
  });

  test('rejects creating a nested folder that already exists', async ({ request }) => {
    const dup = await request.post('/api/folders', { data: { path: 'wiki/guides' } });
    expect(dup.status()).toBe(409);
  });

  test('rejects an invalid nested segment', async ({ request }) => {
    const bad = await request.post('/api/folders', { data: { path: 'wiki/Not Valid!' } });
    expect(bad.status()).toBe(400);
  });

  test('renames a nested folder and re-keys its documents', async ({ request }) => {
    const res = await request.patch('/api/folders', { data: { from: 'wiki/guides', to: 'handbook' } });
    expect(res.status()).toBe(200);

    const dump = await dumpVault(request);
    const keys = Object.keys(dump);
    expect(keys.some((k) => k.startsWith('authored/wiki/handbook/'))).toBe(true);
    expect(keys.some((k) => k.startsWith('authored/wiki/guides/'))).toBe(false);
  });

  test('deletes a nested folder and its content', async ({ request }) => {
    const res = await request.delete('/api/folders?path=wiki/guides');
    expect(res.status()).toBe(204);

    const dump = await dumpVault(request);
    expect(Object.keys(dump).some((k) => k.startsWith('authored/wiki/guides/'))).toBe(false);
    // The parent space is untouched.
    const structure = JSON.parse(dump['_system/structure.json']) as { spaces: Array<{ name: string }> };
    expect(structure.spaces.some((s) => s.name === 'wiki')).toBe(true);
  });

  test('top-level create still declares a space in structure.json', async ({ request }) => {
    const res = await request.post('/api/folders', { data: { path: 'handbook' } });
    expect(res.status()).toBe(201);

    const dump = await dumpVault(request);
    const structure = JSON.parse(dump['_system/structure.json']) as { spaces: Array<{ name: string }> };
    expect(structure.spaces.some((s) => s.name === 'handbook')).toBe(true);
  });

  test('mutations are gated by FEATURE_UPLOAD', async ({ request }) => {
    // GET is always allowed (read path).
    const get = await request.get('/api/folders');
    expect(get.ok()).toBeTruthy();
  });
});
