import { NextResponse } from 'next/server';

import { getSession } from '@/lib/auth-guard';

/**
 * Fixed-window in-memory rate limiter for the chat endpoint. Every
 * `POST /api/chat` invokes Bedrock, so an unthrottled caller is a direct
 * cost surface — the auth gate bounds *who* can call, this bounds *how often*.
 *
 * Scope and honesty: the counter lives in process memory, exactly like the
 * Fuse search index. On the single-container deployment that is a real limit;
 * on serverless it is per-instance best-effort (a cold start resets it, N
 * instances allow N× the budget). That is acceptable for a cost-abuse
 * backstop — it is not a security boundary, and anything stronger would need
 * a shared store the stack deliberately doesn't have.
 *
 * Configuration: `CHAT_RATE_LIMIT` — max requests per minute per principal
 * (session `sub` when the auth gate is on, else client IP). Default 20.
 * `0`/`off` disables the limiter. Read once at module load, like every other
 * env toggle (`web/lib/flags.ts`).
 */

/** Window length. Fixed at one minute; the env var sets the budget within it. */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Max chat requests per window per principal. 0 disables. */
export const CHAT_RATE_LIMIT = (() => {
  const raw = (process.env.CHAT_RATE_LIMIT ?? '').trim().toLowerCase();
  if (raw === '0' || raw === 'off' || raw === 'false' || raw === 'disabled') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
})();

export interface RateCheck {
  allowed: boolean;
  /** Seconds until the current window resets (only meaningful when denied). */
  retryAfterSeconds: number;
}

interface WindowState {
  windowStart: number;
  count: number;
}

/**
 * A fixed-window counter keyed by principal. Pure and clock-injectable so the
 * window arithmetic is unit-testable without timers.
 */
export function createRateLimiter(limit: number, windowMs: number = RATE_LIMIT_WINDOW_MS) {
  const windows = new Map<string, WindowState>();

  return {
    check(key: string, now: number = Date.now()): RateCheck {
      if (limit <= 0) return { allowed: true, retryAfterSeconds: 0 };

      const state = windows.get(key);
      if (!state || now - state.windowStart >= windowMs) {
        // Window rollover doubles as cleanup for this key; sweep other stale
        // keys opportunistically so the map cannot grow without bound.
        if (windows.size > 1000) {
          for (const [k, s] of windows) {
            if (now - s.windowStart >= windowMs) windows.delete(k);
          }
        }
        windows.set(key, { windowStart: now, count: 1 });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      state.count += 1;
      if (state.count <= limit) return { allowed: true, retryAfterSeconds: 0 };
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((state.windowStart + windowMs - now) / 1000)),
      };
    },
  };
}

const chatLimiter = createRateLimiter(CHAT_RATE_LIMIT);

/**
 * Principal key for rate accounting: the session subject when the auth gate
 * is on (stable across proxies), else the nearest client IP. `x-forwarded-for`
 * is spoofable without a fronting proxy — acceptable for a cost backstop, per
 * the module note above.
 */
export async function rateLimitKey(req: Request): Promise<string> {
  const claims = await getSession(req);
  if (claims) return `sub:${claims.sub}`;
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0].trim();
  return `ip:${forwarded || 'unknown'}`;
}

/**
 * Route guard, mirroring `flagGuard`: returns a `429` response when the
 * caller is over budget, or `null` when the request may proceed.
 */
export async function chatRateLimitGuard(req: Request): Promise<NextResponse | null> {
  if (CHAT_RATE_LIMIT <= 0) return null;
  const key = await rateLimitKey(req);
  const result = chatLimiter.check(key);
  if (result.allowed) return null;
  return NextResponse.json(
    { detail: 'rate limit exceeded — retry shortly' },
    { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } },
  );
}
