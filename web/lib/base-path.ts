/**
 * Base-path helpers for serving the portal under a sub-path (e.g. `/wiki`) in
 * a shared cluster.
 *
 * Next.js `basePath` (set in `next.config.ts` from the `NEXT_BASE_PATH`
 * build-arg) automatically prefixes `<Link>`, router navigation, and
 * `next/image` — but NOT raw `fetch('/api/...')`, manual `history.pushState`,
 * or `metadata` asset URLs. Those must be prefixed explicitly with the helpers
 * below.
 *
 * `NEXT_PUBLIC_BASE_PATH` is inlined at build time by `next.config.ts` so the
 * same value is available on both server and client. Empty string means the
 * app is served at the root (`/`).
 */

/** Normalized base path: `""` (root) or a leading-slash, no-trailing-slash path. */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

/**
 * Prefix an app-absolute path (API route, page, or `public/` asset) with the
 * base path. Safe to call when `BASE_PATH` is empty (returns the path
 * unchanged).
 */
export function withBasePath(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${BASE_PATH}${suffix}`;
}

/**
 * Strip the base path from a pathname (e.g. `window.location.pathname`) so the
 * remainder can be parsed as an app route. Always returns a leading-slash path.
 */
export function stripBasePath(pathname: string): string {
  if (BASE_PATH && (pathname === BASE_PATH || pathname.startsWith(`${BASE_PATH}/`))) {
    return pathname.slice(BASE_PATH.length) || '/';
  }
  return pathname;
}
