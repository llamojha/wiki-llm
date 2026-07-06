import matter from 'gray-matter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __dump, __resetWith } from '@/lib/s3-mock';
import { getObject, listObjects } from '@/lib/s3';
import { __resetVaultMode } from '@/lib/vault-mode';
import { isRealPageId } from '@/lib/managed-pages';
import { MANAGED_MARKER_KEY, reconcileManagedVault } from '@/lib/managed-reconcile';

/**
 * Reconcile/backfill (plan 027, specs/managed-mode.md §8): adopt out-of-band
 * files and migrate a provenance vault into `pages/`. Idempotent + dry-run.
 */
describe('reconcileManagedVault', () => {
  beforeEach(() => __resetVaultMode());
  afterEach(() => __resetVaultMode());

  it('dry-run reports actions but writes nothing', async () => {
    __resetWith({
      'authored/wiki/alpha.md': '---\ntitle: Alpha\n---\nbody',
      'notes/plain.md': '# Plain\ntext',
    });
    const before = JSON.stringify(__dump());
    const report = await reconcileManagedVault({ dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.markerWritten).toBe(false);
    expect(report.migrated).toHaveLength(1);
    expect(report.adopted).toHaveLength(1);
    // Nothing changed on disk.
    expect(JSON.stringify(__dump())).toBe(before);
  });

  it('migrates a provenance vault into pages/ with derived origin + a marker', async () => {
    __resetWith({
      'generated/wiki/ai-page.md': '---\ntitle: AI Page\n---\nai body',
      'authored/wiki/human.md': '---\ntitle: Human\n---\nhuman body',
      'authored/wiki/platform/deep.md': '---\ntitle: Deep\n---\ndeep body',
    });

    const report = await reconcileManagedVault({ dryRun: false });

    expect(report.markerWritten).toBe(true);
    expect(report.migrated).toHaveLength(3);

    const keys = (await listObjects()).sort();
    // Objects moved under pages/, sub-path preserved; sources gone.
    expect(keys).toContain('pages/wiki/ai-page.md');
    expect(keys).toContain('pages/wiki/platform/deep.md');
    expect(__dump()[MANAGED_MARKER_KEY]).toBeDefined();
    expect(keys).not.toContain('generated/wiki/ai-page.md');

    // origin derived from the provenance root; a real id assigned.
    const ai = matter(await getObject('pages/wiki/ai-page.md'));
    expect(ai.data.origin).toBe('generated');
    expect(isRealPageId(ai.data.id)).toBe(true);
    const human = matter(await getObject('pages/wiki/human.md'));
    expect(human.data.origin).toBe('authored');
  });

  it('adopts a frontmatter-less synced file in place (same key, real id)', async () => {
    __resetWith({ 'notes/synced.md': '# Synced\ntext' });
    const report = await reconcileManagedVault({ dryRun: false });

    expect(report.adopted).toHaveLength(1);
    expect(report.adopted[0].from).toBe('notes/synced.md');
    expect(report.adopted[0].to).toBe('notes/synced.md'); // no move
    const doc = matter(await getObject('notes/synced.md'));
    expect(isRealPageId(doc.data.id)).toBe(true);
  });

  it('is idempotent — a second run is a no-op (all skipped)', async () => {
    __resetWith({
      'authored/wiki/a.md': '---\ntitle: A\n---\nbody',
      'notes/b.md': '# B',
    });
    await reconcileManagedVault({ dryRun: false });
    const afterFirst = JSON.stringify(__dump());

    const second = await reconcileManagedVault({ dryRun: false });
    expect(second.migrated).toHaveLength(0);
    expect(second.adopted).toHaveLength(0);
    expect(second.skipped).toBeGreaterThan(0);
    // Only the marker's reconciledAt timestamp may differ; page objects stable.
    const dumpAfterSecond = __dump();
    expect(dumpAfterSecond['pages/wiki/a.md']).toBe(JSON.parse(afterFirst)['pages/wiki/a.md']);
    expect(dumpAfterSecond['notes/b.md']).toBe(JSON.parse(afterFirst)['notes/b.md']);
  });

  it('reports a collision without overwriting (non-destructive)', async () => {
    // Two provenance docs collide on the same pages/ target.
    __resetWith({
      'generated/wiki/dup.md': '---\ntitle: Gen Dup\n---\ngen',
      'authored/wiki/dup.md': '---\ntitle: Auth Dup\n---\nauth',
    });
    const report = await reconcileManagedVault({ dryRun: false });

    expect(report.migrated).toHaveLength(1);
    expect(report.conflicts).toHaveLength(1);
    // The loser is left in place — no data lost.
    const keys = await listObjects();
    const survivingSources = keys.filter((k) => k === 'generated/wiki/dup.md' || k === 'authored/wiki/dup.md');
    expect(survivingSources).toHaveLength(1);
    expect(keys).toContain('pages/wiki/dup.md');
  });
});
