import { describe, expect, it } from 'vitest';

import { APP_ROOT, safeReturnTo } from '@/lib/auth-url';

/**
 * Open-redirect guard (plan 029). A crafted `?returnTo=` must never bounce a
 * logged-in user to a hostile origin.
 */
describe('safeReturnTo', () => {
  it('allows a same-origin absolute path', () => {
    expect(safeReturnTo('/docs/onboarding')).toBe('/docs/onboarding');
    expect(safeReturnTo('/a/b?c=d')).toBe('/a/b?c=d');
  });

  it('rejects absolute URLs', () => {
    expect(safeReturnTo('https://evil.com/x')).toBe(APP_ROOT);
    expect(safeReturnTo('http://evil.com')).toBe(APP_ROOT);
  });

  it('rejects protocol-relative and backslash tricks', () => {
    expect(safeReturnTo('//evil.com')).toBe(APP_ROOT);
    expect(safeReturnTo('/\\evil.com')).toBe(APP_ROOT);
  });

  it('falls back to the app root when empty/absent', () => {
    expect(safeReturnTo(null)).toBe(APP_ROOT);
    expect(safeReturnTo(undefined)).toBe(APP_ROOT);
    expect(safeReturnTo('')).toBe(APP_ROOT);
  });
});
