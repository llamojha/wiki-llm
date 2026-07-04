/**
 * Normalizers for gray-matter frontmatter values. YAML turns unquoted ISO
 * timestamps into Date objects and numeric-looking scalars into numbers;
 * every read must pass through here before entering a `string`-typed contract.
 */
export function fmString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** Like fmString but with a fallback when the result is empty. */
export function fmStringOr(v: unknown, fallback: string): string {
  return fmString(v) || fallback;
}
