import { DEFAULT_USER_ID } from './paths.js';

/**
 * Scope mirror of `web/lib/scope.ts`.
 *
 * Kept as a copy in the Lambda bundle rather than imported from the web
 * package because the Lambda has its own minimal `paths.ts` and is bundled
 * independently. Keep the two files behaviorally aligned.
 */
export type Scope = 'shared' | 'user';

export type ScopeSelector = {
  scope: Scope;
  userId?: string;
};

export type ScopePaths = {
  scope: Scope;
  userId?: string;
  rawPrefix: string;
  systemPrefix: string;
  generatedPrefix: (space: string) => string;
  authoredPrefix: (space: string) => string;
  systemKey: (name: string) => string;
  personalPrefix?: string;
};

function joinSlash(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/');
}

export function resolveScope(selector: ScopeSelector): ScopePaths {
  if (selector.scope === 'shared') {
    return {
      scope: 'shared',
      rawPrefix: 'raw/',
      systemPrefix: '_system/',
      generatedPrefix: (space: string) => `generated/${space}/`,
      authoredPrefix: (space: string) => `authored/${space}/`,
      systemKey: (name: string) => joinSlash('_system/', name),
    };
  }

  const userId = selector.userId ?? DEFAULT_USER_ID;
  const userRoot = `users/${userId}`;

  return {
    scope: 'user',
    userId,
    rawPrefix: `${userRoot}/raw/`,
    systemPrefix: `${userRoot}/_system/`,
    generatedPrefix: (space: string) => `${userRoot}/generated/${space}/`,
    authoredPrefix: (space: string) => `${userRoot}/authored/${space}/`,
    systemKey: (name: string) => joinSlash(`${userRoot}/_system/`, name),
    personalPrefix: `${userRoot}/authored/personal/`,
  };
}
