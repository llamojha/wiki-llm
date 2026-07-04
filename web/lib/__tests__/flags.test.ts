import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `flags.ts` reads env once at module load (`export const FLAGS =
 * computeFlags()`), so every case resets modules and re-imports with the env
 * it wants. Contract: a present var wins (ON unless a falsy token); an absent
 * var falls back to the per-feature default (agent ON, everything else OFF).
 */
describe('feature flag parsing', () => {
  const saved = { ...process.env };

  beforeEach(() => vi.resetModules());
  afterEach(() => {
    process.env = { ...saved };
  });

  it('absent var falls back to default (agent on, upload off)', async () => {
    delete process.env.FEATURE_AGENT;
    delete process.env.FEATURE_UPLOAD;
    const { FLAGS } = await import('@/lib/flags');
    expect(FLAGS.agent).toBe(true);
    expect(FLAGS.upload).toBe(false);
  });

  const offTokens = ['off', 'false', '0', 'no', 'disabled', 'OFF', 'Disabled', '  false  '];
  for (const token of offTokens) {
    it(`treats ${JSON.stringify(token)} as OFF`, async () => {
      process.env.FEATURE_AGENT = token;
      const { FLAGS } = await import('@/lib/flags');
      expect(FLAGS.agent).toBe(false);
    });
  }

  const onValues = ['on', '1', 'yes', 'banana', 'true'];
  for (const value of onValues) {
    it(`treats ${JSON.stringify(value)} as ON`, async () => {
      process.env.FEATURE_UPLOAD = value;
      const { FLAGS } = await import('@/lib/flags');
      expect(FLAGS.upload).toBe(true);
    });
  }
});
