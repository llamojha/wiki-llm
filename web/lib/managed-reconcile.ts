import matter from 'gray-matter';

import {
  deleteObject,
  getObject,
  listObjects,
  ObjectAlreadyExistsError,
  putObject,
  putObjectIfAbsent,
} from '@/lib/s3';
import { type Origin } from '@/lib/origin';
import {
  generatePageId,
  isRealPageId,
  PAGES_ROOT,
  slugForKey,
  spacePathForKey,
} from '@/lib/managed-pages';

/**
 * Reconcile / backfill for managed mode (plan 027, specs/managed-mode.md §8).
 *
 * One idempotent, dry-run-capable pass that promotes a vault to fully-tracked
 * managed pages. It serves two jobs:
 *
 *  1. **Adopt out-of-band files** — a recognized `.md` (dropped via `aws s3
 *     sync`, an Obsidian export) that has no real `pg_…` id gets one written
 *     into its frontmatter *in place* (same key), with `origin`/`status`
 *     defaults. Nesting continues to come from the path (parent_id left unset →
 *     path fallback).
 *  2. **provenance → managed migration** — a document under a provenance root
 *     (`generated/`, `authored/`, or the per-user mirrors) is rewritten with an
 *     `origin` derived from its root and **moved** to `pages/<space>/<rest…>/
 *     <slug>.md`, preserving the sub-path so the tree still nests correctly.
 *
 * Recognition here is deliberately **mode-independent** (path regexes, not
 * `isDocumentKey`) so it works on a vault that currently sniffs as `provenance`
 * or `folders`. Re-running is a no-op: files already under `pages/` with a real
 * id are skipped, and a target-collision is reported rather than overwritten
 * (non-destructive). On a non-dry run it also writes the `_system/managed.json`
 * marker so the vault subsequently sniffs as managed.
 */

export type ReconcileItem = {
  from: string;
  to: string;
  id: string;
  origin: Origin;
};

export type ReconcileReport = {
  dryRun: boolean;
  adopted: ReconcileItem[];
  migrated: ReconcileItem[];
  conflicts: { from: string; to: string }[];
  skipped: number;
  markerWritten: boolean;
};

export const MANAGED_MARKER_KEY = '_system/managed.json';

const RAW_RE = /^raw\//;
const USER_RAW_RE = /^users\/[^/]+\/raw\//;

/** A recognized candidate document, independent of the current vault mode. */
function isCandidate(key: string): boolean {
  if (!key.endsWith('.md')) return false;
  if (key.startsWith('_system/')) return false;
  if (RAW_RE.test(key) || USER_RAW_RE.test(key)) return false;
  if (key.split('/').pop() === '.keep') return false;
  return true;
}

type ProvenanceInfo = { space: string; rest: string[]; slug: string; origin: Origin };

/**
 * If `key` lives under a provenance root, return its managed coordinates
 * (space/sub-path/slug + derived origin); else null. Personal user pages map to
 * `origin: authored` (there is no `personal` origin in the vocabulary).
 */
function provenanceInfo(key: string): ProvenanceInfo | null {
  const split = (rel: string, origin: Origin): ProvenanceInfo => {
    const parts = rel.split('/').filter(Boolean);
    const file = parts.pop()!;
    const slug = file.replace(/\.md$/, '');
    const [space = '', ...rest] = parts;
    return { space, rest, slug, origin };
  };
  let m: RegExpMatchArray | null;
  if ((m = key.match(/^generated\/(.+)$/))) return split(m[1], 'generated');
  if ((m = key.match(/^authored\/(.+)$/))) return split(m[1], 'authored');
  if ((m = key.match(/^users\/[^/]+\/generated\/(.+)$/))) return split(m[1], 'generated');
  if ((m = key.match(/^users\/[^/]+\/authored\/(.+)$/))) return split(m[1], 'authored');
  return null;
}

/** Build managed frontmatter for a page, preserving any existing fields. */
function buildFrontmatter(
  existing: Record<string, unknown>,
  info: { id: string; space: string; slug: string; origin: Origin },
): Record<string, unknown> {
  const fm = { ...existing };
  fm.id = info.id;
  if (!fm.title) {
    fm.title = info.slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  fm.space = info.space;
  fm.slug = info.slug;
  fm.origin = info.origin;
  if (!fm.status) fm.status = 'published';
  // parent_id intentionally left unset → path-derived placement (§6).
  return fm;
}

export async function reconcileManagedVault(
  opts: { dryRun?: boolean } = {},
): Promise<ReconcileReport> {
  const dryRun = opts.dryRun ?? true;
  const report: ReconcileReport = {
    dryRun,
    adopted: [],
    migrated: [],
    conflicts: [],
    skipped: 0,
    markerWritten: false,
  };

  const keys = (await listObjects()).filter(isCandidate);

  for (const key of keys) {
    let raw: string;
    try {
      raw = await getObject(key);
    } catch {
      continue; // unreadable — skip
    }
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;
    const hasRealId = isRealPageId(data.id);

    const prov = provenanceInfo(key);
    if (prov) {
      // MIGRATE: move under pages/<space>/<rest…>/<slug>.md with managed fm.
      const target = [PAGES_ROOT, prov.space, ...prov.rest, `${prov.slug}.md`]
        .filter(Boolean)
        .join('/');
      const id = hasRealId ? String(data.id) : generatePageId();
      const fm = buildFrontmatter(data, { id, space: prov.space, slug: prov.slug, origin: prov.origin });
      const body = matter.stringify(parsed.content, fm);
      if (!dryRun) {
        try {
          await putObjectIfAbsent(target, body);
        } catch (err) {
          if (err instanceof ObjectAlreadyExistsError) {
            report.conflicts.push({ from: key, to: target });
            continue; // non-destructive: leave the source in place
          }
          throw err;
        }
        await deleteObject(key);
      }
      report.migrated.push({ from: key, to: target, id, origin: prov.origin });
      continue;
    }

    // Non-provenance candidate (plain sync or already under pages/).
    if (hasRealId) {
      report.skipped += 1;
      continue; // already a tracked managed page
    }
    // ADOPT in place: assign an id, keep the key + path-derived placement.
    const { space } = spacePathForKey(key);
    const slug = slugForKey(key);
    const id = generatePageId();
    const fm = buildFrontmatter(data, { id, space, slug, origin: 'authored' });
    const body = matter.stringify(parsed.content, fm);
    if (!dryRun) await putObject(key, body);
    report.adopted.push({ from: key, to: key, id, origin: 'authored' });
  }

  if (!dryRun) {
    await putObject(
      MANAGED_MARKER_KEY,
      `${JSON.stringify({ version: 1, reconciledAt: new Date().toISOString() }, null, 2)}\n`,
    );
    report.markerWritten = true;
  }

  return report;
}
