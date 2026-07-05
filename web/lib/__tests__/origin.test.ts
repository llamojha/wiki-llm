import { describe, expect, it } from 'vitest';

import { DEFAULT_ORIGIN, isOrigin, readOrigin } from '@/lib/origin';

/**
 * The `origin` vocabulary is the folders/managed-mode provenance model (plan
 * 026): a frontmatter value, not a folder. These pin the read precedence
 * (`origin` → legacy `source_type` → default) and the closed value set.
 */
describe('isOrigin', () => {
  it('accepts the four vocabulary values', () => {
    for (const v of ['authored', 'generated', 'uploaded', 'imported']) {
      expect(isOrigin(v)).toBe(true);
    }
  });

  it('rejects everything else', () => {
    for (const v of ['personal', 'file', '', 'AUTHORED', undefined, null, 3]) {
      expect(isOrigin(v)).toBe(false);
    }
  });
});

describe('readOrigin', () => {
  it('prefers the canonical origin field', () => {
    expect(readOrigin({ origin: 'generated', source_type: 'authored' })).toBe('generated');
  });

  it('falls back to legacy source_type when origin is absent', () => {
    expect(readOrigin({ source_type: 'generated' })).toBe('generated');
    expect(readOrigin({ source_type: 'uploaded' })).toBe('uploaded');
  });

  it('maps provenance source_type: personal to authored', () => {
    expect(readOrigin({ source_type: 'personal' })).toBe('authored');
  });

  it('defaults to authored for missing, empty, or unknown values', () => {
    expect(readOrigin(null)).toBe(DEFAULT_ORIGIN);
    expect(readOrigin(undefined)).toBe(DEFAULT_ORIGIN);
    expect(readOrigin({})).toBe('authored');
    expect(readOrigin({ origin: 'nonsense' })).toBe('authored');
  });

  it('coerces non-string frontmatter scalars before matching', () => {
    expect(readOrigin({ origin: 123 })).toBe('authored');
  });
});
