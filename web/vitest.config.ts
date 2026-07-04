import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
    // `s3.ts` throws at import time unless a bucket is configured or the mock
    // is active; the modules under test (agent-tools, search) import it
    // transitively. Force the in-memory mock so imports succeed without AWS.
    env: { MOCK_S3: '1' },
  },
  resolve: { alias: { '@': path.resolve(__dirname) } },
});
