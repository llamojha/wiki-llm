import matter from 'gray-matter';

import { fmString } from '@/lib/frontmatter';
import { DEFAULT_ORIGIN, readOrigin, type Origin } from '@/lib/origin';
import { FOLDER_SEGMENT_RE, PAGES_ROOT } from '@/lib/vault-paths';

/**
 * Managed-mode page frontmatter (plan 027, specs/managed-mode.md §4).
 *
 * Frontmatter is the single source of truth for all page metadata — there is no
 * separate page-record store. `id` is the stable join key (referenced by
 * `parent_id` and `assets/<id>/`); the tree edge lives in `parent_id`. A file
 * dropped out-of-band (via `aws s3 sync`) may carry none of these — such a page
 * is *adopted* with a deterministic fallback id derived from its key (§7), so it
 * renders stably until a reconcile pass (§8) backfills real frontmatter.
 */

export type PageStatus = 'published' | 'draft';

export const PAGE_STATUSES: readonly PageStatus[] = ['published', 'draft'];

/** The parsed, defaults-applied view of a managed page's metadata. */
export type ManagedPage = {
  /** S3 key of the `.md` object. */
  key: string;
  /** Stable page id — real (`pg_…`) if tracked, else a derived fallback (`pgk_…`). */
  id: string;
  /** Whether `id` came from frontmatter (tracked) or was derived (adopted). */
  adopted: boolean;
  title: string;
  /** Top-level grouping, derived from the key when absent from frontmatter. */
  space: string;
  slug: string;
  /** Parent page id, or null when top-level / path-derived (see managed-tree). */
  parentId: string | null;
  status: PageStatus;
  origin: Origin;
  labels: string[];
};

const REAL_ID_RE = /^pg_[a-z0-9]+$/i;
const FALLBACK_ID_PREFIX = 'pgk_';

/** Whether a value is a real, frontmatter-assigned managed page id. */
export function isRealPageId(value: unknown): boolean {
  return typeof value === 'string' && REAL_ID_RE.test(value);
}

/**
 * Generate a fresh, sortable page id: `pg_` + base36 millisecond timestamp +
 * random suffix. Roughly time-ordered (ULID-like) without adding a dependency.
 * `now`/`rand` are injectable for deterministic tests.
 */
export function generatePageId(
  now: number = Date.now(),
  rand: () => string = randomSuffix,
): string {
  const ts = Math.max(0, Math.floor(now)).toString(36).padStart(9, '0');
  return `pg_${ts}${rand()}`;
}

function randomSuffix(len = 6): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/**
 * Deterministic fallback id for an un-adopted (frontmatter-less) file, derived
 * from its S3 key via FNV-1a. Stable across renders and processes so
 * `parent_id` references, `assets/` binding, and tree keys don't churn before a
 * reconcile backfills a real `pg_…` id. Distinct `pgk_` prefix marks it derived.
 */
export function fallbackIdForKey(key: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${FALLBACK_ID_PREFIX}${(hash >>> 0).toString(36)}`;
}

/**
 * Derive the `space` (top-level grouping) and remaining nested path segments
 * from an S3 key, stripping a leading `pages/` store prefix. Used both to
 * default the frontmatter `space` and to compute the path-derived tree fallback.
 *
 * - `pages/wiki/lambda.md` → space `wiki`, rest `[]`
 * - `pages/wiki/platform/x.md` → space `wiki`, rest `[platform]`
 * - `notes/deep/a.md` (out-of-band) → space `notes`, rest `[deep]`
 * - `root.md` → space `''`, rest `[]`
 */
export function spacePathForKey(key: string): { space: string; rest: string[] } {
  let parts = key.split('/').filter(Boolean);
  if (parts[0] === PAGES_ROOT) parts = parts.slice(1);
  const withoutFile = parts.slice(0, -1);
  const [space = '', ...rest] = withoutFile;
  return { space, rest };
}

/** Slug (filename stem) for a key. */
export function slugForKey(key: string): string {
  return key.split('/').pop()!.replace(/\.md$/, '');
}

function titleFromSlug(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function readStatus(v: unknown): PageStatus {
  return fmString(v) === 'draft' ? 'draft' : 'published';
}

/** Read `labels`/`tags` frontmatter into a string[] (tolerant of scalar/array). */
function readLabels(fm: Record<string, unknown>): string[] {
  const raw = fm.labels ?? fm.tags;
  if (Array.isArray(raw)) return raw.map((x) => fmString(x)).filter(Boolean);
  const single = fmString(raw);
  return single ? [single] : [];
}

/**
 * Parse a managed page from its key + raw file contents, applying all defaults.
 * Pure — does no S3 I/O. A file with no frontmatter is *adopted*: it gets a
 * deterministic fallback id and path-derived placement (parentId null → the
 * tree builder applies the path fallback, §6).
 */
export function parseManagedPage(key: string, raw: string): ManagedPage {
  const { data } = matter(raw);
  const fm = (data ?? {}) as Record<string, unknown>;

  const rawId = fmString(fm.id);
  const tracked = isRealPageId(rawId);
  const id = tracked ? rawId : fallbackIdForKey(key);

  const { space: keySpace } = spacePathForKey(key);
  const slug = fmString(fm.slug) || slugForKey(key);
  const space = fmString(fm.space) || keySpace;
  const title = fmString(fm.title) || titleFromSlug(slug);
  const parentIdRaw = fmString(fm.parent_id);

  return {
    key,
    id,
    adopted: !tracked,
    title,
    space,
    slug,
    parentId: parentIdRaw || null,
    status: readStatus(fm.status),
    origin: readOrigin(fm),
    labels: readLabels(fm),
  };
}

export class ManagedPageError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'ManagedPageError';
  }
}

/** Validate a slug or space segment; throws ManagedPageError on a bad value. */
export function assertSegment(kind: 'slug' | 'space', value: string): void {
  if (!value) throw new ManagedPageError(`${kind} is required`);
  if (!FOLDER_SEGMENT_RE.test(value)) {
    throw new ManagedPageError(
      `${kind} must be lowercase alphanumeric with hyphens (got "${value}")`,
    );
  }
}

/** The S3 key for a managed page under the canonical `pages/<space>/<slug>.md`. */
export function managedPageKey(space: string, slug: string): string {
  return `${PAGES_ROOT}/${space}/${slug}.md`;
}

export type ManagedPageInput = {
  id: string;
  title: string;
  space: string;
  slug: string;
  parentId?: string | null;
  status?: PageStatus;
  origin?: Origin;
  labels?: string[];
};

/**
 * Serialize a managed page to a Markdown string with canonical frontmatter.
 * Only meaningful fields are written: `parent_id` is omitted when null (absent
 * ⇒ top-level / path fallback), `labels` when empty. `origin` defaults to
 * `DEFAULT_ORIGIN`, `status` to `published`.
 */
export function stringifyManagedPage(input: ManagedPageInput, body: string): string {
  assertSegment('space', input.space);
  assertSegment('slug', input.slug);
  const fm: Record<string, unknown> = {
    id: input.id,
    title: input.title,
    space: input.space,
    slug: input.slug,
    status: input.status ?? 'published',
    origin: input.origin ?? DEFAULT_ORIGIN,
  };
  if (input.parentId) fm.parent_id = input.parentId;
  if (input.labels && input.labels.length) fm.labels = input.labels;
  return matter.stringify(body, fm);
}
