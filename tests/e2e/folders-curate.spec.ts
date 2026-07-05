import { expect, test } from '@playwright/test';

/**
 * Folders-mode AI curate pipeline (plan 026). The curate Lambda can't run
 * locally, so — like `curate.spec.ts` — we simulate its output: seed the
 * curated page it would have written into the destination folder (tagged
 * `origin: generated`) plus a `done` folders-mode job, then drive the REAL
 * `/api/curate/finalize` and assert the page becomes discoverable and
 * classifies as generated. Separately, drive the REAL `/api/curate/start` to
 * assert the folders-mode validation contract (no structure.json involved).
 *
 * Seeds via `/api/test-seed` with only plain folders + `_system/` job state so
 * the server sniffs `folders` mode (a `structure.json` or `generated/` key
 * would flip it to provenance).
 */
const GEN_KEY = 'wiki/curated-idea-abc12345.md';

const foldersCurateSeed = {
  'inbox/idea.md': '---\ntitle: Raw Idea\n---\n\nRough notes about migratory pelicans.',
  // Simulated Lambda output: a curated page in the destination folder with
  // provenance in frontmatter, not a `generated/` path.
  [GEN_KEY]:
    '---\ntitle: Curated Idea\nsource_type: generated\norigin: generated\n---\n\n# Curated Idea\n\nStructured writeup about xenobiology.',
  '_system/jobs/job-folders-1.json': JSON.stringify({
    id: 'job-folders-1',
    status: 'done',
    mode: 'folders',
    source: 'inbox',
    destination: 'wiki',
    space: 'wiki',
    scope: 'shared',
    total: 1,
    completed: 1,
    files: [{ key: 'inbox/idea.md', status: 'done', pages: [GEN_KEY] }],
    startedAt: '2026-07-05T12:00:00.000Z',
    completedAt: '2026-07-05T12:00:05.000Z',
    error: null,
  }),
};

test.describe('folders-mode curate', () => {
  test.beforeEach(async ({ request }) => {
    const res = await request.post('/api/test-seed', { data: { seed: foldersCurateSeed } });
    expect(res.ok()).toBeTruthy();
  });

  test('finalize makes the curated page discoverable and classifies it generated', async ({ request }) => {
    const fin = await request.post('/api/curate/finalize', {
      data: { jobId: 'job-folders-1' },
    });
    expect(fin.ok()).toBeTruthy();
    const finBody = (await fin.json()) as { finalized?: boolean };
    expect(finBody.finalized).toBe(true);

    // The curated page is served through the always-on doc GET and reads as
    // generated provenance (frontmatter, not a folder).
    const doc = await request.get(`/api/docs/${GEN_KEY}`);
    expect(doc.status()).toBe(200);
    const docBody = (await doc.json()) as { title: string; source_type: string };
    expect(docBody.title).toBe('Curated Idea');
    expect(docBody.source_type).toBe('generated');

    // And it's searchable after the finalize search-cache invalidation.
    const search = await request.get('/api/search?q=xenobiology');
    expect(search.ok()).toBeTruthy();
    const results = (await search.json()) as Array<{ id: string; source_type: string }>;
    const hit = results.find((r) => r.id === GEN_KEY);
    expect(hit).toBeTruthy();
    expect(hit?.source_type).toBe('generated');
  });

  test('start rejects a missing destination (400)', async ({ request }) => {
    const res = await request.post('/api/curate/start', {
      data: { source: 'inbox', destination: '' },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).detail).toContain('destination folder is required');
  });

  test('start 404s when the source folder has no documents', async ({ request }) => {
    const res = await request.post('/api/curate/start', {
      data: { source: 'nonexistent-folder', destination: 'wiki' },
    });
    expect(res.status()).toBe(404);
    expect((await res.json()).detail).toContain('no source documents found');
  });
});
