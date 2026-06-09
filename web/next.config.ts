import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  // This is a pnpm workspace; pin the file-tracing root to the repo root so
  // standalone output traces workspace deps deterministically (and silences
  // the multi-root inference warning).
  outputFileTracingRoot: path.join(import.meta.dirname, '..'),
};

export default config;
