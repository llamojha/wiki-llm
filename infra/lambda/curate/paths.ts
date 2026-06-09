export const DEFAULT_USER_ID = process.env.VAULT_USER_ID ?? 'amllamojha';
export const USER_ROOT = `users/${DEFAULT_USER_ID}`;
export const RAW_PREFIX = 'raw/';
export const GENERATED_ROOT = 'generated';
export const SYSTEM_ROOT = '_system';

export function generatedPrefix(space: string): string {
  return `${GENERATED_ROOT}/${space}/`;
}

export function systemKey(name: string): string {
  return `${SYSTEM_ROOT}/${name}`.replace(/\/+/g, '/');
}

/**
 * Lowercase a single directory-name segment for use in S3 keys.
 * Local to this module so paths.ts stays dependency-free of source-card.ts —
 * keeps the helper safe to import from anywhere (no cycle risk).
 */
function segmentSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Derive the sub-folder for a per-source page under `sources/` deterministically
 * from the rawKey. No LLM call, no taxonomy drift — the placement mirrors the
 * shape of `raw/` so re-extracting the same rawKey always produces the same path.
 *
 * Examples:
 *   raw/projects/CodeMMORPG/PRD.md            → projects/codemmorpg
 *   raw/projects/AIvaro/docs/roadmap.md       → projects/aivaro
 *   users/amllamojha/raw/projects/X/notes.md  → projects/x
 *   raw/people/john.md                        → people
 *   raw/random-note.md                        → inbox  (no sub-folder)
 */
export function placementFromRawKey(rawKey: string): string {
  const project = rawKey.match(/(?:^|\/)raw\/projects\/([^/]+)\//);
  if (project) {
    const slug = segmentSlug(project[1]);
    return slug ? `projects/${slug}` : 'inbox';
  }

  const top = rawKey.match(/(?:^|\/)raw\/([^/]+)\//);
  if (top) {
    const slug = segmentSlug(top[1]);
    return slug || 'inbox';
  }

  return 'inbox';
}

/**
 * Full S3 key for a per-source page given the scope's generated prefix,
 * the placement (from `placementFromRawKey`), and the slug (from `sourceSlug`).
 */
export function sourcePageKey(scopeGeneratedPrefix: string, placement: string, slug: string): string {
  return `${scopeGeneratedPrefix}sources/${placement}/${slug}.md`;
}
