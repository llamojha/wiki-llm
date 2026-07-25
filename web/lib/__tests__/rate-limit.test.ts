import { describe, expect, it } from 'vitest';

import { createRateLimiter } from '@/lib/rate-limit';

describe('createRateLimiter — fixed window', () => {
  it('allows up to the limit within one window', () => {
    const limiter = createRateLimiter(3, 60_000);
    const t0 = 1_000_000;
    expect(limiter.check('a', t0).allowed).toBe(true);
    expect(limiter.check('a', t0 + 1).allowed).toBe(true);
    expect(limiter.check('a', t0 + 2).allowed).toBe(true);
    expect(limiter.check('a', t0 + 3).allowed).toBe(false);
  });

  it('reports seconds until the window resets when denied', () => {
    const limiter = createRateLimiter(1, 60_000);
    const t0 = 1_000_000;
    limiter.check('a', t0);
    const denied = limiter.check('a', t0 + 30_000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(30);
  });

  it('resets the budget when the window rolls over', () => {
    const limiter = createRateLimiter(1, 60_000);
    const t0 = 1_000_000;
    expect(limiter.check('a', t0).allowed).toBe(true);
    expect(limiter.check('a', t0 + 1).allowed).toBe(false);
    expect(limiter.check('a', t0 + 60_000).allowed).toBe(true);
  });

  it('tracks principals independently', () => {
    const limiter = createRateLimiter(1, 60_000);
    const t0 = 1_000_000;
    expect(limiter.check('a', t0).allowed).toBe(true);
    expect(limiter.check('b', t0).allowed).toBe(true);
    expect(limiter.check('a', t0 + 1).allowed).toBe(false);
    expect(limiter.check('b', t0 + 1).allowed).toBe(false);
  });

  it('limit 0 disables the limiter', () => {
    const limiter = createRateLimiter(0, 60_000);
    for (let i = 0; i < 100; i++) {
      expect(limiter.check('a', 1_000_000 + i).allowed).toBe(true);
    }
  });
});
