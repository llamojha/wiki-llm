import { NextResponse } from 'next/server';

/**
 * Feature flags — per-feature, env-controlled. Single source of truth.
 *
 * Each flag is read once at module load from a `FEATURE_*` env var. A feature
 * is ON unless its env var is explicitly set to a falsy token
 * (`off` / `false` / `0` / `no` / `disabled`). An absent var ⇒ ON, so every
 * shipped feature keeps working with no env changes — flags default enabled.
 *
 * Flags gate BOTH layers:
 *   1. UI — `FLAGS` is passed from the root server component into the client
 *      `AppShell` as a prop, which hides disabled entry points.
 *   2. Routes — `flagGuard(name)` short-circuits the matching route handler.
 * Hiding the button alone is not feature control; the route guard is the
 * enforcement that actually matters.
 *
 * Server-only module (imports `next/server`). Client components may import
 * the `FeatureFlags`/`FeatureName` *types* (erased at build) but never the
 * values — they receive flag values as props instead.
 */

export type FeatureName =
  | 'agent'
  | 'upload'
  | 'curate'
  | 'reindex'
  | 'editor'
  | 'search'
  | 'star'
  | 'publishing';

export type FeatureFlags = Record<FeatureName, boolean>;

/** Maps each feature to the env var that controls it. */
const ENV_BY_FEATURE: Record<FeatureName, string> = {
  agent: 'FEATURE_AGENT',
  upload: 'FEATURE_UPLOAD',
  curate: 'FEATURE_CURATE',
  reindex: 'FEATURE_REINDEX',
  editor: 'FEATURE_EDITOR',
  search: 'FEATURE_SEARCH',
  star: 'FEATURE_STAR',
  publishing: 'FEATURE_PUBLISHING',
};

/** Tokens that turn a feature off. Anything else (or absent) leaves it on. */
const OFF_TOKENS = new Set(['off', 'false', '0', 'no', 'disabled']);

function parseFlag(envVar: string): boolean {
  const raw = process.env[envVar];
  if (raw == null) return true; // default ON — shipped features stay live
  return !OFF_TOKENS.has(raw.trim().toLowerCase());
}

function computeFlags(): FeatureFlags {
  const out = {} as FeatureFlags;
  for (const feature of Object.keys(ENV_BY_FEATURE) as FeatureName[]) {
    out[feature] = parseFlag(ENV_BY_FEATURE[feature]);
  }
  return out;
}

/** Resolved flag values, computed once at module load. */
export const FLAGS: FeatureFlags = computeFlags();

export function isEnabled(feature: FeatureName): boolean {
  return FLAGS[feature];
}

/**
 * Route-handler guard. Returns a 404 `NextResponse` when the feature is
 * disabled, or `null` when enabled. 404 (not 403) so a disabled feature
 * looks like it doesn't exist rather than advertising a locked door.
 *
 *   const blocked = flagGuard('agent');
 *   if (blocked) return blocked;
 */
export function flagGuard(feature: FeatureName): NextResponse | null {
  if (FLAGS[feature]) return null;
  return NextResponse.json(
    { detail: `Feature "${feature}" is disabled` },
    { status: 404 },
  );
}
