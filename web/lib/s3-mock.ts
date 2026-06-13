/**
 * In-memory mock of the S3 module surface used by `web/lib/s3.ts`.
 *
 * Activated when `MOCK_S3=1` is set on the server process — see `s3.ts`
 * which re-exports from here at module load. Provides the exact same
 * exported names so route handlers don't know the difference.
 *
 * State is held on `globalThis` so it survives Next dev's hot-module reloads
 * and is shared across all route handlers within one server process — that
 * matters because each Playwright test seeds the store, then drives the UI
 * through real API routes that read and write back to the same Map.
 *
 * Tests reset/seed via `POST /api/__test__/seed` (mock-mode only).
 */

import { createHash } from 'node:crypto';

type StoreState = {
  /** Relative key → UTF-8 content. */
  objects: Map<string, string>;
  /** Relative key → ETag (quoted, like real S3). */
  etags: Map<string, string>;
  /** Relative key → last-modified time. */
  modified: Map<string, Date>;
};

const GLOBAL_KEY = '__vaultmark_mock_s3__';

function store(): StoreState {
  const g = globalThis as unknown as Record<string, StoreState | undefined>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      objects: new Map(),
      etags: new Map(),
      modified: new Map(),
    };
  }
  return g[GLOBAL_KEY]!;
}

function etagOf(content: string): string {
  return `"${createHash('md5').update(content).digest('hex')}"`;
}

export class ConcurrencyError extends Error {
  constructor(message = 'PreconditionFailed') {
    super(message);
    this.name = 'ConcurrencyError';
  }
}

export class ObjectAlreadyExistsError extends Error {
  constructor(message = 'ObjectAlreadyExists') {
    super(message);
    this.name = 'ObjectAlreadyExistsError';
  }
}

class NoSuchKeyError extends Error {
  constructor(key: string) {
    super(`NoSuchKey: ${key}`);
    this.name = 'NoSuchKey';
  }
}

export async function listSpaces(): Promise<string[]> {
  const out = new Set<string>();
  for (const key of store().objects.keys()) {
    const head = key.split('/')[0];
    if (head) out.add(head);
  }
  return [...out];
}

export async function listObjects(subPrefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const key of store().objects.keys()) {
    if (!subPrefix || key.startsWith(subPrefix)) out.push(key);
  }
  return out;
}

export async function listCssObjects(subPrefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const key of store().objects.keys()) {
    if ((!subPrefix || key.startsWith(subPrefix)) && key.endsWith('.css')) {
      out.push(key);
    }
  }
  return out;
}

export async function getObject(relKey: string): Promise<string> {
  const v = store().objects.get(relKey);
  if (v == null) throw new NoSuchKeyError(relKey);
  return v;
}

export async function headObject(relKey: string): Promise<{ lastModified: Date | null }> {
  const m = store().modified.get(relKey);
  if (!m) throw new NoSuchKeyError(relKey);
  return { lastModified: m };
}

export async function getObjectWithETag(
  relKey: string,
): Promise<{ content: string; etag: string }> {
  const content = store().objects.get(relKey);
  if (content == null) throw new NoSuchKeyError(relKey);
  return { content, etag: store().etags.get(relKey) ?? etagOf(content) };
}

export async function putObject(
  relKey: string,
  body: string,
  ifMatch?: string,
): Promise<string> {
  const s = store();
  if (ifMatch) {
    const current = s.etags.get(relKey);
    if (current && current !== ifMatch) throw new ConcurrencyError();
  }
  const etag = etagOf(body);
  s.objects.set(relKey, body);
  s.etags.set(relKey, etag);
  s.modified.set(relKey, new Date());
  return etag;
}

export async function putObjectIfAbsent(
  relKey: string,
  body: string,
): Promise<string> {
  const s = store();
  if (s.objects.has(relKey)) throw new ObjectAlreadyExistsError();
  const etag = etagOf(body);
  s.objects.set(relKey, body);
  s.etags.set(relKey, etag);
  s.modified.set(relKey, new Date());
  return etag;
}

export async function deleteObject(relKey: string): Promise<void> {
  const s = store();
  s.objects.delete(relKey);
  s.etags.delete(relKey);
  s.modified.delete(relKey);
}

/** Test-only: replace all stored objects. Used by `/api/__test__/seed`. */
export function __resetWith(seed: Record<string, string>): void {
  const s = store();
  s.objects.clear();
  s.etags.clear();
  s.modified.clear();
  const now = new Date();
  for (const [k, v] of Object.entries(seed)) {
    s.objects.set(k, v);
    s.etags.set(k, etagOf(v));
    s.modified.set(k, now);
  }
}

/** Test-only: dump current store. */
export function __dump(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of store().objects) out[k] = v;
  return out;
}
