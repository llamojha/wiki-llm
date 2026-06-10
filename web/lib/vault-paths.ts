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

export function generatedPrefix(space: string): string {
  return `${GENERATED_ROOT}/${space}/`;
}

export function authoredPrefix(space: string): string {
  return `${AUTHORED_ROOT}/${space}/`;
}

export function userPrefix(userId = DEFAULT_USER_ID): string {
  return `${USERS_ROOT}/${userId}/`;
}

export function userRawPrefix(userId = DEFAULT_USER_ID): string {
  return `${USERS_ROOT}/${userId}/raw/`;
}

export function userGeneratedPrefix(space: string, userId = DEFAULT_USER_ID): string {
  return `${USERS_ROOT}/${userId}/generated/${space}/`;
}

export function userAuthoredPrefix(space: string, userId = DEFAULT_USER_ID): string {
  return `${USERS_ROOT}/${userId}/authored/${space}/`;
}

export function personalPrefix(userId = DEFAULT_USER_ID): string {
  return userAuthoredPrefix(PERSONAL_SPACE, userId);
}

export function userSystemKey(name: string, userId = DEFAULT_USER_ID): string {
  return `${USERS_ROOT}/${userId}/_system/${name}`.replace(/\/+/g, '/');
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

export function generatedSpaceFromKey(key: string): string | null {
  if (key.startsWith(`${GENERATED_ROOT}/`)) {
    return key.slice(GENERATED_ROOT.length + 1).split('/')[0] || null;
  }
  return key.match(/^users\/[^/]+\/generated\/([^/]+)\//)?.[1] ?? null;
}

export function authoredSpaceFromKey(key: string): string | null {
  if (key.startsWith(`${AUTHORED_ROOT}/`)) {
    return key.slice(AUTHORED_ROOT.length + 1).split('/')[0] || null;
  }
  return key.match(/^users\/[^/]+\/authored\/([^/]+)\//)?.[1] ?? null;
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
