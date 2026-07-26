// Vault path constants + key classification. Scoped-prefix resolution is
// owned by `web/lib/scope.ts` (resolveScope) — keep it there, not here.
import { vaultMode } from '@/lib/vault-mode';

export const USERS_ROOT = 'users';
// Inlined at build time (NEXT_PUBLIC_*) so server routes and client
// components agree on the same value. Rebuild after changing it.
export const DEFAULT_USER_ID = process.env.NEXT_PUBLIC_VAULT_USER_ID ?? 'default';
export const DEFAULT_USER_ROOT = `${USERS_ROOT}/${DEFAULT_USER_ID}`;
export const RAW_PREFIX = 'raw/';
export const GENERATED_ROOT = 'generated';
export const AUTHORED_ROOT = 'authored';
export const SYSTEM_ROOT = '_system';
export const PERSONAL_SPACE = 'personal';

export const PROVENANCE_ROOTS = new Set([
  RAW_PREFIX.replace(/\/$/, ''),
  GENERATED_ROOT,
  AUTHORED_ROOT,
  USERS_ROOT,
  SYSTEM_ROOT,
]);

/** A single folder-path segment: lowercase alphanumeric + hyphens. */
export const FOLDER_SEGMENT_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Normalize a user-supplied folder path (upload subfolder, curate
 * source/destination) to a clean slash-joined relative path with no leading or
 * trailing slashes (e.g. `"guides/setup"`), or `''` when none was given.
 * Returns `null` when any segment is malformed so callers can reject with a 400
 * rather than writing to a surprising key — each segment must match
 * `FOLDER_SEGMENT_RE`, which keeps S3 keys lowercase and rejects `..` traversal.
 */
export function normalizeFolderPath(raw: string | null | undefined): string | null {
  if (!raw) return '';
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return '';
  const segments = trimmed.split('/').filter(Boolean);
  for (const seg of segments) {
    if (!FOLDER_SEGMENT_RE.test(seg)) return null;
  }
  return segments.join('/');
}

/**
 * Vault name for the top-bar pill (server-side; pass to clients as a prop).
 * `VAULT_ID` doubles as the display name; null (unset or the 'default'
 * sentinel) hides the pill.
 */
export function vaultDisplayName(): string | null {
  const id = (process.env.VAULT_ID ?? '').trim();
  return id && id !== 'default' ? id : null;
}

/**
 * S3 location prefix for the upload-destination preview (server-side; pass to
 * clients as a prop). Mirrors how `web/lib/s3.ts` resolves the bucket/prefix
 * from the runtime environment so the modal shows the *real* destination
 * instead of a hardcoded bucket name. Returns a trailing-slash base such as
 * `s3://my-bucket/` or `s3://my-bucket/team-vault/`.
 */
export function vaultS3Location(): string {
  const bucket = (process.env.VAULT_BUCKET ?? '').trim() || 'mock-bucket';
  const prefix = (process.env.VAULT_PREFIX ?? '').trim().replace(/^\/+|\/+$/g, '');
  return `s3://${bucket}/${prefix ? `${prefix}/` : ''}`;
}

export function generatedPrefix(space: string): string {
  return `${GENERATED_ROOT}/${space}/`;
}

export function authoredPrefix(space: string): string {
  return `${AUTHORED_ROOT}/${space}/`;
}

export function personalPrefix(userId = DEFAULT_USER_ID): string {
  return `${USERS_ROOT}/${userId}/authored/${PERSONAL_SPACE}/`;
}

export function systemKey(name: string): string {
  return `${SYSTEM_ROOT}/${name}`.replace(/\/+/g, '/');
}

/**
 * File extensions recognized as documents. Markdown is the canonical authored
 * format; `.html` is a first-class *content* type (plan 022) — imported/rendered
 * but never authored by the portal.
 */
export const DOC_EXTENSIONS = ['.md', '.html'] as const;

/** Whether a key ends in a recognized document extension. */
export function hasDocExtension(key: string): boolean {
  return DOC_EXTENSIONS.some((ext) => key.endsWith(ext));
}

/**
 * Whether a key is an HTML document. HTML is first-class *content* but is
 * browse/upload-only (plan 022 §1) — the portal never authors it. Write paths
 * that round-trip gray-matter and persist `matter.stringify(...)` (editor PUT,
 * star PATCH) must reject these keys, or they would inject YAML frontmatter
 * into the `.html` object and corrupt it.
 */
export function isHtmlKey(key: string): boolean {
  return key.endsWith('.html');
}

/** Strip a recognized document extension (`.md`/`.html`) from a key. */
function stripDocExtension(key: string): string {
  return key.replace(/\.(md|html)$/, '');
}

/**
 * Whether an S3 key is a browsable/searchable document. Mode-aware:
 *
 * - **provenance**: a `.md`/`.html` under a content root (`generated/`,
 *   `authored/`, or the per-user mirrors), excluding reserved system files.
 * - **folders / managed**: any `.md`/`.html` outside `_system/`, minus `.keep`
 *   markers and `raw/` scratch inputs. Top-level folders *are* the spaces;
 *   root-level `index.md`/`log.md` are ordinary user docs (only `_system/` is
 *   reserved). Managed mode recognizes the *same* keys as folders — it differs
 *   only in how the tree is assembled (frontmatter `parent_id`), so the two
 *   share this predicate. See `specs/managed-mode.md` §5.
 */
export function isDocumentKey(key: string): boolean {
  if (!hasDocExtension(key)) return false;

  if (vaultMode() === 'folders' || vaultMode() === 'managed') {
    if (key.startsWith(`${SYSTEM_ROOT}/`)) return false;
    // Raw pipeline inputs are scratch, not browsable documents — exclude them
    // even in folders/managed mode so un-curated uploads (present only when
    // curate/raw is opted in) never leak into the sidebar/search/read route.
    if (key.startsWith(RAW_PREFIX)) return false;
    if (key.match(/^users\/[^/]+\/raw\//)) return false;
    const filename = key.split('/').pop()!;
    if (filename === '.keep') return false;
    return true;
  }

  if (key.startsWith(RAW_PREFIX)) return false;
  if (key.startsWith(`${SYSTEM_ROOT}/`)) return false;
  if (key.match(/^users\/[^/]+\/raw\//)) return false;
  if (key.match(/^users\/[^/]+\/_system\//)) return false;
  const filename = key.split('/').pop()!;
  if (filename === 'index.md' || filename === 'log.md') return false;
  if (filename.match(/^log-.*\.md$/)) return false;
  if (filename === '.keep') return false;
  return key.startsWith(`${GENERATED_ROOT}/`)
    || key.startsWith(`${AUTHORED_ROOT}/`)
    || Boolean(key.match(/^users\/[^/]+\/generated\//))
    || Boolean(key.match(/^users\/[^/]+\/authored\//));
}

/**
 * Whether a document key lives inside the named space. Mode-aware, mirroring
 * how each mode lays spaces out on S3:
 *
 * - **provenance**: a space is partitioned across provenance roots and mirrored
 *   per user, so `wiki` matches `generated/wiki/…`, `authored/wiki/…`, and the
 *   `users/<id>/…` mirrors of both. Cross-user isolation is NOT this function's
 *   job — `isInAllowedScope` owns that gate and both are applied together.
 * - **folders / managed**: the key path *is* the tree path, so the space is a
 *   plain path prefix (and may itself be nested, e.g. `guides/setup`). Managed
 *   mode builds its tree from frontmatter `parent_id` rather than the key path,
 *   so there a space filter follows storage layout, not the rendered tree.
 *
 * An empty space name means "no narrowing" and matches every key.
 */
export function isKeyInSpace(key: string, space: string): boolean {
  const name = space.replace(/^\/+|\/+$/g, '');
  if (!name) return true;

  if (vaultMode() === 'folders' || vaultMode() === 'managed') {
    return key.startsWith(`${name}/`);
  }

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^(users/[^/]+/)?(${GENERATED_ROOT}|${AUTHORED_ROOT})/${escaped}/`,
  ).test(key);
}

export function sourceTypeFromKey(key: string): 'generated' | 'authored' | 'personal' {
  // Folders/managed mode have no provenance roots — everything is user content.
  // Frontmatter `source_type`/`origin` still wins at the read site.
  if (vaultMode() === 'folders' || vaultMode() === 'managed') return 'authored';
  if (key.startsWith(`${GENERATED_ROOT}/`) || key.match(/^users\/[^/]+\/generated\//)) return 'generated';
  if (key.match(/^users\/[^/]+\/authored\/personal\//)) return 'personal';
  return 'authored';
}

export function displayPathForKey(key: string): string {
  // Folders/managed mode: the key *is* the display path — no provenance root
  // to strip.
  if (vaultMode() === 'folders' || vaultMode() === 'managed') {
    return stripDocExtension(key).split('/').join(' / ');
  }
  let displayKey = key;
  const personal = personalPrefix();
  if (displayKey.startsWith(personal)) {
    displayKey = displayKey.slice(personal.length);
    return displayKey.replace(/\.md$/, '').split('/').join(' / ');
  }
  for (const root of [GENERATED_ROOT, AUTHORED_ROOT]) {
    const prefix = `${root}/`;
    if (displayKey.startsWith(prefix)) {
      displayKey = displayKey.slice(prefix.length);
      break;
    }
  }
  const userGenerated = displayKey.match(/^users\/[^/]+\/generated\/(.+)$/);
  if (userGenerated) displayKey = userGenerated[1];
  const userAuthored = displayKey.match(/^users\/[^/]+\/authored\/(.+)$/);
  if (userAuthored) displayKey = userAuthored[1];
  return displayKey.replace(/\.md$/, '').split('/').join(' / ');
}
