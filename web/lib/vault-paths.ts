// Vault path constants + key classification. Scoped-prefix resolution is
// owned by `web/lib/scope.ts` (resolveScope) — keep it there, not here.
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

export function isDocumentKey(key: string): boolean {
  if (!key.endsWith('.md')) return false;
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

export function sourceTypeFromKey(key: string): 'generated' | 'authored' | 'personal' {
  if (key.startsWith(`${GENERATED_ROOT}/`) || key.match(/^users\/[^/]+\/generated\//)) return 'generated';
  if (key.match(/^users\/[^/]+\/authored\/personal\//)) return 'personal';
  return 'authored';
}

export function displayPathForKey(key: string): string {
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
