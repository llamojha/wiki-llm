/**
 * Vault mode — how the portal recognizes and organizes documents.
 *
 * - `'provenance'` — the original layout: documents live under `generated/`,
 *   `authored/`, or the per-user `users/<id>/…` mirrors; spaces are declared in
 *   `_system/structure.json`. This is what the AI curation pipeline produces.
 * - `'folders'` — the zero-config on-ramp: any `.md`/`.html` under the vault
 *   (outside `_system/`) is a document, and the top-level folders *are* the
 *   spaces. Lets a user point the portal at an existing folder of Markdown notes
 *   and have it just work.
 *
 * Resolution order (highest wins):
 *   1. Explicit `VAULT_MODE=folders|provenance`.
 *   2. Sniff — `provenance` if `_system/structure.json` exists OR any
 *      `generated/`/`authored/` document is present; else `folders`.
 *   3. Default `folders`.
 *
 * `ensureVaultMode()` (async) resolves and caches the mode; `vaultMode()` (sync)
 * returns the cached value for the many synchronous `isDocumentKey` filter
 * predicates. Every list-consuming entry point awaits `ensureVaultMode()` before
 * it filters, so the sync value is always resolved by the time it is read. See
 * `specs/folder-first-vault.md`.
 */
export type VaultMode = 'folders' | 'provenance';

const STRUCTURE_KEY = '_system/structure.json';

// Under the in-memory mock (unit + e2e tests) the S3 store is reseeded between
// cases, so a cached mode would leak across tests with different vault shapes.
// Re-sniff every call in mock mode (the store is in-memory — the cost is nil);
// cache the resolved promise only in real deployments.
const useMock = process.env.MOCK_S3 === '1' || process.env.MOCK_S3 === 'true';

// The synchronous handle read by `vaultMode()`. Until the first
// `ensureVaultMode()` resolves it is `null`; the getter then falls back to
// `provenance` — the conservative choice that preserves the original behavior
// for any path that reads the mode before resolving it. Real filter paths await
// `ensureVaultMode()` first, so they never see the fallback.
let _mode: VaultMode | null = null;
let _promise: Promise<VaultMode> | null = null;
let _logged = false;

function readEnvMode(): VaultMode | null {
  const raw = (process.env.VAULT_MODE ?? '').trim().toLowerCase();
  if (raw === 'folders' || raw === 'provenance') return raw;
  return null;
}

function announce(mode: VaultMode, how: 'env' | 'sniffed'): void {
  _mode = mode;
  if (_logged) return;
  _logged = true;
  // Mirror the `[s3] runtime config …` line so "why is my portal empty/full?"
  // is a one-glance answer in the server log.
  console.info(`[vault] mode=${mode} (${how})`);
}

async function sniff(): Promise<VaultMode> {
  // Import the S3 facade lazily. `s3.ts` throws at module load when no bucket is
  // configured (a server-only precondition); a static import here would pull it
  // into every client bundle that transitively imports `vault-paths`/`scope` and
  // crash hydration. The sniff only ever runs server-side, so a dynamic import
  // keeps `s3.ts` out of the client graph entirely.
  const { headObject, listObjects } = await import('@/lib/s3');
  // A declared-spaces manifest is the unambiguous provenance signal — present
  // even for a provenance vault whose spaces are still empty.
  try {
    await headObject(STRUCTURE_KEY);
    return 'provenance';
  } catch {
    // no structure.json — fall through to the content probe
  }
  const [generated, authored] = await Promise.all([
    listObjects('generated/'),
    listObjects('authored/'),
  ]);
  if (generated.length || authored.length) return 'provenance';
  return 'folders';
}

/**
 * Resolve the vault mode (env → sniff → default) and cache it. Idempotent;
 * safe to await at the top of every list-consuming entry point.
 */
export async function ensureVaultMode(): Promise<VaultMode> {
  const explicit = readEnvMode();
  if (explicit) {
    announce(explicit, 'env');
    return explicit;
  }
  if (!useMock && _promise) return _promise;
  const p = sniff().then((mode) => {
    announce(mode, 'sniffed');
    return mode;
  });
  if (!useMock) _promise = p;
  return p;
}

/** The resolved mode, or `provenance` if `ensureVaultMode()` has not run yet. */
export function vaultMode(): VaultMode {
  return _mode ?? 'provenance';
}

/** Test-only: force the mode without an S3 sniff. */
export function __setVaultMode(mode: VaultMode): void {
  _mode = mode;
  _promise = Promise.resolve(mode);
}

/** Test-only: clear the cached mode so the next `ensureVaultMode()` re-resolves. */
export function __resetVaultMode(): void {
  _mode = null;
  _promise = null;
  _logged = false;
}
