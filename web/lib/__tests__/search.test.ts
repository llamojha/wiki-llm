import { describe, expect, it } from 'vitest';

import { isAllowedByScope } from '@/lib/search';
import type { SearchOptions } from '@/lib/search';

/**
 * Search post-filters Fuse hits by scope (the index walks all of S3 today).
 * This mirrors the agent-tools scope matrix for the `SearchOptions` shape,
 * including the `scope:'user'` case with and without an explicit `userId`.
 */
describe('isAllowedByScope', () => {
  const shared = (o: Partial<SearchOptions> = {}): SearchOptions => ({ scope: 'shared', ...o });
  const user = (o: Partial<SearchOptions> = {}): SearchOptions => ({ scope: 'user', ...o });

  it('scope "both" (default) allows every key', () => {
    for (const key of ['generated/wiki/a.md', 'users/alice/authored/personal/a.md']) {
      expect(isAllowedByScope(key, {})).toBe(true);
      expect(isAllowedByScope(key, { scope: 'both' })).toBe(true);
    }
  });

  it('scope "shared" allows only shared keys', () => {
    expect(isAllowedByScope('generated/wiki/a.md', shared())).toBe(true);
    expect(isAllowedByScope('users/alice/generated/wiki/a.md', shared())).toBe(false);
  });

  it('scope "user" with userId isolates that user', () => {
    expect(isAllowedByScope('users/alice/authored/personal/a.md', user({ userId: 'alice' }))).toBe(true);
    expect(isAllowedByScope('users/bob/authored/personal/a.md', user({ userId: 'alice' }))).toBe(false);
    expect(isAllowedByScope('generated/wiki/a.md', user({ userId: 'alice' }))).toBe(false);
  });

  it('scope "user" without userId accepts any user-scoped key', () => {
    // No userId ⇒ the id check is skipped; any users/<id>/ key passes but
    // shared keys still do not.
    expect(isAllowedByScope('users/alice/authored/personal/a.md', user())).toBe(true);
    expect(isAllowedByScope('users/bob/authored/personal/a.md', user())).toBe(true);
    expect(isAllowedByScope('generated/wiki/a.md', user())).toBe(false);
  });
});
