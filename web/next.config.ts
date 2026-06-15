import path from 'node:path';
import type { NextConfig } from 'next';

// Optional sub-path the portal is served under in a shared cluster (e.g.
// "/wiki"). Supplied at build time via the NEXT_BASE_PATH build-arg/env (see
// web/Dockerfile). `basePath` is a build-time setting in Next.js, so this must
// be present during `next build` — setting it only at runtime has no effect.
//
// Normalized to either "" (root) or a leading-slash, no-trailing-slash path so
// "/wiki", "wiki", and "/wiki/" all resolve to "/wiki".
const rawBasePath = (process.env.NEXT_BASE_PATH ?? '').trim();
const basePath =
  rawBasePath === '' || rawBasePath === '/'
    ? ''
    : `/${rawBasePath.replace(/^\/+/, '').replace(/\/+$/, '')}`;

const config: NextConfig = {
  output: 'standalone',
  // This is a pnpm workspace; pin the file-tracing root to the repo root so
  // standalone output traces workspace deps deterministically (and silences
  // the multi-root inference warning).
  outputFileTracingRoot: path.join(import.meta.dirname, '..'),
  ...(basePath
    ? {
        basePath,
        // Expose the normalized base path to app code. basePath only
        // auto-prefixes <Link>, router navigation, and next/image; raw
        // fetch('/api/...'), history.pushState, and metadata asset URLs read
        // this via web/lib/base-path.ts. Inlined into both bundles at build.
        env: { NEXT_PUBLIC_BASE_PATH: basePath },
      }
    : {}),
};

export default config;
