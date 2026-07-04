import { describe, expect, it } from 'vitest';

import { inferScopeFromKey } from '@/lib/scope';

/**
 * `inferScopeFromKey` routes index/log writes and read gating to the right
 * scope purely from an S3 key's leading segments. Only a `users/<id>/` prefix
 * (with a non-empty id segment followed by a slash) counts as user scope;
 * everything else is shared.
 */
describe('inferScopeFromKey', () => {
  it('maps users/<id>/... to that user scope', () => {
    const s = inferScopeFromKey('users/alice/authored/wiki/x.md');
    expect(s.scope).toBe('user');
    expect(s.userId).toBe('alice');
  });

  it('maps root-level keys to shared scope', () => {
    for (const key of ['generated/wiki/x.md', 'authored/wiki/x.md', 'raw/x.pdf', '_system/log.md']) {
      const s = inferScopeFromKey(key);
      expect(s.scope).toBe('shared');
      expect(s.userId).toBeUndefined();
    }
  });

  it('treats a users/ prefix with no id segment as shared', () => {
    // No trailing slash after the (missing) id segment → not a user subtree.
    expect(inferScopeFromKey('users/x.md').scope).toBe('shared');
    expect(inferScopeFromKey('users/alice').scope).toBe('shared');
    expect(inferScopeFromKey('users/').scope).toBe('shared');
  });
});
