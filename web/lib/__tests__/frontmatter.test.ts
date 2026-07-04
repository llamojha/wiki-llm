import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';

import { fmString, fmStringOr } from '@/lib/frontmatter';

/**
 * gray-matter parses YAML with js-yaml: an unquoted ISO timestamp becomes a
 * Date and a numeric-looking scalar becomes a number. These helpers are the
 * single boundary that coerces such values into the `string`-typed contracts
 * (DocSummary.updated, SearchEntry.title, …) before they leak downstream.
 */
describe('fmString', () => {
  it('passes strings through unchanged', () => {
    expect(fmString('hello')).toBe('hello');
    expect(fmString('')).toBe('');
  });

  it('converts a Date to an ISO string', () => {
    const d = new Date('2026-07-03T10:00:00.000Z');
    expect(fmString(d)).toBe('2026-07-03T10:00:00.000Z');
  });

  it('stringifies numbers and booleans', () => {
    expect(fmString(3)).toBe('3');
    expect(fmString(0)).toBe('0');
    expect(fmString(true)).toBe('true');
    expect(fmString(false)).toBe('false');
  });

  it('returns empty string for nullish, arrays, and objects', () => {
    expect(fmString(null)).toBe('');
    expect(fmString(undefined)).toBe('');
    expect(fmString({})).toBe('');
    expect(fmString(['a'])).toBe('');
  });
});

describe('fmStringOr', () => {
  it('returns the value when non-empty', () => {
    expect(fmStringOr('x', 'fallback')).toBe('x');
    expect(fmStringOr(42, 'fallback')).toBe('42');
  });

  it('returns the fallback for empty results', () => {
    expect(fmStringOr('', 'fallback')).toBe('fallback');
    expect(fmStringOr(null, 'fallback')).toBe('fallback');
    expect(fmStringOr(undefined, 'fallback')).toBe('fallback');
    expect(fmStringOr({}, 'fallback')).toBe('fallback');
  });
});

describe('integration: unquoted YAML scalars from gray-matter', () => {
  it('coerces an unquoted date and numeric title into strings', () => {
    const { data } = matter('---\nupdated: 2026-07-03T10:00:00Z\ntitle: 42\n---\nbody');
    // Sanity: js-yaml really did produce non-string scalars here.
    expect(data.updated).toBeInstanceOf(Date);
    expect(typeof data.title).toBe('number');

    expect(fmString(data.updated)).toBe('2026-07-03T10:00:00.000Z');
    expect(fmStringOr(data.title, 'x')).toBe('42');
  });
});
