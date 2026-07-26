import { getStructure, spacesForScope, type SpaceEntry } from '@/lib/vault-structure';
import type { ScopePaths } from '@/lib/scope';
import { normalizeFolderPath, SYSTEM_ROOT } from '@/lib/vault-paths';

export const INGEST_SPACE = 'wiki';

export type IngestPolicy = {
  space: string;
  rawPrefix: string;
  generatedPrefix: string;
};

/**
 * Folders-mode ingest policy (plan 026). There are no provenance roots or
 * `structure.json` spaces — curation reads ordinary user files from a
 * caller-chosen **source** folder and writes curated pages into a caller-chosen
 * **destination** folder, tagged `origin: generated` in frontmatter. Both are
 * plain folder paths in the single-tenant folder tree.
 */
export type FoldersIngestPolicy = {
  mode: 'folders';
  /** Normalized source folder path, no trailing slash (`''` = vault root). */
  source: string;
  /** Normalized destination folder path, no trailing slash. */
  destination: string;
  /** Source prefix for `listObjects` — always ends in `/` unless the root. */
  sourcePrefix: string;
};

/** Validation failure from `resolveFoldersIngest`, distinguishable from a policy. */
export type IngestError = { error: string };

export function isIngestError(v: unknown): v is IngestError {
  return typeof v === 'object' && v !== null && 'error' in v;
}

/**
 * Validate + normalize a folders-mode curate request. The destination must be a
 * non-empty folder (curated pages need a home); the source may be any folder
 * (empty = whole vault root). Source and destination must differ so curation
 * can't re-ingest its own output. The destination must not be `_system/`.
 */
export function resolveFoldersIngest(
  sourceRaw: string | null | undefined,
  destinationRaw: string | null | undefined,
): FoldersIngestPolicy | IngestError {
  const source = normalizeFolderPath(sourceRaw);
  if (source === null) {
    return { error: 'source folder segments must be lowercase alphanumeric with hyphens only' };
  }
  const destination = normalizeFolderPath(destinationRaw);
  if (destination === null) {
    return { error: 'destination folder segments must be lowercase alphanumeric with hyphens only' };
  }
  if (!destination) {
    return { error: 'destination folder is required' };
  }
  if (destination === SYSTEM_ROOT || destination.startsWith(`${SYSTEM_ROOT}/`)) {
    return { error: `destination cannot be under ${SYSTEM_ROOT}/` };
  }
  if (source === destination) {
    return { error: 'source and destination folders must differ' };
  }
  return {
    mode: 'folders',
    source,
    destination,
    sourcePrefix: source ? `${source}/` : '',
  };
}

/** A resolved source folder to count pending curate inputs under. */
export type PendingSource = { source: string; sourcePrefix: string };

/**
 * Resolve the source folder for a folders-mode *pending count*.
 *
 * An **absent** `source` is not the vault root — it means the caller never
 * chose one. Treating it as the root makes `listObjects('')` return every
 * document in the vault, so the Library reports the whole wiki as un-curated
 * raw input ("98 raw files in `raw/`" on a vault that has no `raw/` at all).
 * Only an explicitly empty `?source=` selects the root, which
 * `resolveFoldersIngest` does allow for a deliberate whole-vault curate.
 */
export function resolvePendingSource(sourceRaw: string | null): PendingSource | IngestError {
  if (sourceRaw === null) {
    return { error: 'source folder is required to count pending files' };
  }
  const source = normalizeFolderPath(sourceRaw);
  if (source === null) {
    return { error: 'source folder segments must be lowercase alphanumeric with hyphens only' };
  }
  return { source, sourcePrefix: source ? `${source}/` : '' };
}

function findIngestSpace(spaces: SpaceEntry[]): string | null {
  const explicit = spaces.find((space) => space.generated === true);
  if (explicit) return explicit.name;

  const wiki = spaces.find((space) => space.name === INGEST_SPACE);
  if (wiki?.generated === false) return null;
  if (wiki) return wiki.name;

  return null;
}

/**
 * Resolve the ingest policy for a given scope.
 *
 * Spaces are per-scope, so the candidate list is read from the scope's own
 * declaration; the raw/generated prefixes are scope-specific so curation only
 * ever reads and writes inside the active scope's subtree.
 */
export async function getIngestPolicy(scope: ScopePaths): Promise<IngestPolicy | null> {
  const structure = await getStructure();
  const space = findIngestSpace(spacesForScope(structure, scope.scope, scope.userId));
  if (!space) return null;
  return {
    space,
    rawPrefix: scope.rawPrefix,
    generatedPrefix: scope.generatedPrefix(space),
  };
}
