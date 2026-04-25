import {
  AUTHORED_ROOT,
  DEFAULT_USER_ID,
  GENERATED_ROOT,
  PERSONAL_SPACE,
  RAW_PREFIX,
  SYSTEM_ROOT,
  USERS_ROOT,
} from '@/lib/vault-paths';

/**
 * Scope of a vault operation.
 *
 * - `'shared'` — root-level prefixes (`raw/`, `generated/<space>/`,
 *   `authored/<space>/`, `_system/`). Visible to every user in a multi-tenant
 *   setup (Phase 6); today it's the shared library.
 * - `'user'` — a single user's subtree (`users/<id>/raw/`, etc.). Isolated
 *   from shared content and from other users' subtrees.
 *
 * Every operation that reads or writes vault content takes a scope. Mixing
 * scopes inside one operation is a bug.
 */
export type Scope = 'shared' | 'user';

export type ScopeSelector = {
  scope: Scope;
  /** Required when `scope === 'user'`. Defaults to `DEFAULT_USER_ID`. */
  userId?: string;
};

export type ScopePaths = {
  scope: Scope;
  /** Present iff `scope === 'user'`. */
  userId?: string;
  /** `raw/` for shared, `users/<id>/raw/` for user scope. */
  rawPrefix: string;
  /** `_system/` for shared, `users/<id>/_system/` for user scope. */
  systemPrefix: string;
  /** Returns the generated prefix for a given space. */
  generatedPrefix: (space: string) => string;
  /** Returns the authored prefix for a given space. */
  authoredPrefix: (space: string) => string;
  /** Resolves a `_system/<name>` key inside this scope. */
  systemKey: (name: string) => string;
  /**
   * `users/<id>/authored/personal/` — only present on user scope. The personal
   * wiki is by definition user-scoped; the field is absent on shared scope.
   */
  personalPrefix?: string;
};

const SHARED_RAW_PREFIX = RAW_PREFIX;
const SHARED_GENERATED_ROOT = `${GENERATED_ROOT}/`;
const SHARED_AUTHORED_ROOT = `${AUTHORED_ROOT}/`;
const SHARED_SYSTEM_PREFIX = `${SYSTEM_ROOT}/`;

function joinSlash(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/');
}

export function resolveScope(selector: ScopeSelector): ScopePaths {
  if (selector.scope === 'shared') {
    return {
      scope: 'shared',
      rawPrefix: SHARED_RAW_PREFIX,
      systemPrefix: SHARED_SYSTEM_PREFIX,
      generatedPrefix: (space: string) => `${SHARED_GENERATED_ROOT}${space}/`,
      authoredPrefix: (space: string) => `${SHARED_AUTHORED_ROOT}${space}/`,
      systemKey: (name: string) => joinSlash(SHARED_SYSTEM_PREFIX, name),
    };
  }

  const userId = selector.userId ?? DEFAULT_USER_ID;
  const userRoot = `${USERS_ROOT}/${userId}`;

  return {
    scope: 'user',
    userId,
    rawPrefix: `${userRoot}/raw/`,
    systemPrefix: `${userRoot}/_system/`,
    generatedPrefix: (space: string) => `${userRoot}/generated/${space}/`,
    authoredPrefix: (space: string) => `${userRoot}/authored/${space}/`,
    systemKey: (name: string) => joinSlash(`${userRoot}/_system/`, name),
    personalPrefix: `${userRoot}/authored/${PERSONAL_SPACE}/`,
  };
}

/**
 * Infer scope from an S3 key by looking at its leading segments.
 *
 * Used when a route handler receives a key from the client (e.g. on edit,
 * delete, star) and needs to route index regeneration and log appends to the
 * right scope's `_system/`.
 */
export function inferScopeFromKey(key: string): ScopePaths {
  const userMatch = key.match(/^users\/([^/]+)\//);
  if (userMatch) {
    return resolveScope({ scope: 'user', userId: userMatch[1] });
  }
  return resolveScope({ scope: 'shared' });
}
