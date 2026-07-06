import { fmString } from '@/lib/frontmatter';

/**
 * Provenance vocabulary for folders/managed modes (spec folder-first-vault.md
 * §8, plan 026). In folders mode provenance is a **frontmatter value, not a
 * folder** — there is no `generated/`/`authored/` root to key off. The canonical
 * field is `origin`; the pre-026 `source_type` field is a read-time fallback so
 * existing pages keep classifying correctly.
 */
export const ORIGINS = ['authored', 'generated', 'uploaded', 'imported'] as const;

export type Origin = (typeof ORIGINS)[number];

/** A folders-mode doc with no provenance frontmatter is user-written content. */
export const DEFAULT_ORIGIN: Origin = 'authored';

export function isOrigin(value: unknown): value is Origin {
  return typeof value === 'string' && (ORIGINS as readonly string[]).includes(value);
}

/**
 * Resolve a document's provenance from its frontmatter.
 *
 * Precedence: canonical `origin` → legacy `source_type` → `DEFAULT_ORIGIN`.
 * Provenance mode's `source_type: personal` (per-user authored) maps to
 * `authored`, since folders mode has no personal tree. Unknown values fall back
 * to the default rather than leaking an arbitrary string into the vocabulary.
 */
export function readOrigin(fm: Record<string, unknown> | null | undefined): Origin {
  if (!fm) return DEFAULT_ORIGIN;
  const raw = fmString(fm.origin) || fmString(fm.source_type);
  if (isOrigin(raw)) return raw;
  if (raw === 'personal') return 'authored';
  return DEFAULT_ORIGIN;
}
