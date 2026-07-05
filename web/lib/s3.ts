/**
 * S3 client facade — dispatches to either the real AWS S3 implementation or
 * the in-memory mock (`s3-mock.ts`) based on `MOCK_S3=1`.
 *
 * The mock path is used by Playwright e2e tests so the full Next.js + API
 * route stack can be exercised without touching AWS. In all other contexts
 * (dev, prod) this re-exports the real boto3-backed implementation.
 */

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import * as mock from './s3-mock';

const useMock = process.env.MOCK_S3 === '1' || process.env.MOCK_S3 === 'true';

if (!useMock && !process.env.VAULT_BUCKET) {
  throw new Error('VAULT_BUCKET env var required');
}

const bucket = process.env.VAULT_BUCKET ?? 'mock-bucket';
const prefix = process.env.VAULT_PREFIX ?? '';
const region = process.env.VAULT_REGION ?? 'us-east-1';

// Per-operation tracing. Off by default; set DEBUG_S3=1 to log every object
// read/write/delete/list (key, byte size, ETag) to the server log. Independent
// of this flag, the resolved runtime config is logged once below and all S3
// errors are surfaced regardless.
const DEBUG_S3 = process.env.DEBUG_S3 === '1' || process.env.DEBUG_S3 === 'true';

// Log the resolved S3 runtime config once at module load. This is the first
// thing to check when a deployment points at the wrong vault ("why is it
// empty?", "why am I seeing stale docs?") — it pins down exactly which
// bucket/prefix/region the server resolved, and whether the in-memory mock is
// active. Credentials are never logged; they come from the standard AWS
// credential chain (env, shared config, instance/task role).
console.info(
  `[s3] runtime config — bucket=${bucket} prefix=${prefix || '<none>'} ` +
    `region=${region} useMock=${useMock}`,
);

let _client: S3Client | null = null;

function client(): S3Client {
  if (!_client) {
    _client = new S3Client({ region });
  }
  return _client;
}

function fullKey(relKey: string): string {
  return prefix ? `${prefix}/${relKey}`.replace(/^\//, '') : relKey;
}

/** DEBUG_S3-gated per-operation trace. No-op unless DEBUG_S3 is set. */
function trace(op: string, detail: string): void {
  if (DEBUG_S3) console.log(`[s3] ${op} ${detail}${useMock ? ' (mock)' : ''}`);
}

/**
 * Document file extensions the listing layer surfaces. The single choke point
 * for "what counts as a document blob" — kept in lockstep with the mock
 * (`s3-mock.ts`) so e2e and prod agree. `.css` is deliberately NOT here: theme
 * plugins are `.css` and no write route ever creates one (see `listCssObjects`).
 */
export const DOC_LIST_EXTENSIONS = ['.md', '.html'] as const;

function hasListedExtension(rel: string): boolean {
  return DOC_LIST_EXTENSIONS.some((ext) => rel.endsWith(ext));
}

/** List document keys (`.md`/`.html`) under the vault prefix, relative to prefix. */
export async function listObjects(subPrefix = ''): Promise<string[]> {
  trace('LIST', subPrefix || '<root>');
  if (useMock) return mock.listObjects(subPrefix);
  const searchPrefix = subPrefix
    ? `${prefix}/${subPrefix}`.replace(/^\//, '')
    : prefix;

  const keys: string[] = [];
  let token: string | undefined;

  do {
    const res = await client().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: searchPrefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) {
      const key = obj.Key ?? '';
      const rel = key.startsWith(prefix)
        ? key.slice(prefix.length).replace(/^\//, '')
        : key;
      if (hasListedExtension(rel)) keys.push(rel);
    }
    token = res.NextContinuationToken;
  } while (token);

  return keys;
}

/**
 * List *every* key under a sub-prefix, regardless of extension. Returns keys
 * relative to the vault prefix.
 *
 * Unlike `listObjects` (which is deliberately `.md`-only), this surfaces
 * `.keep` markers and any other objects. Folder administration needs it: an
 * empty nested folder is represented solely by a `.keep` marker, so renaming or
 * deleting such a folder requires seeing keys that `listObjects` filters out.
 */
export async function listAllKeys(subPrefix = ''): Promise<string[]> {
  trace('LIST all', subPrefix || '<root>');
  if (useMock) return mock.listAllKeys(subPrefix);
  const searchPrefix = subPrefix
    ? `${prefix}/${subPrefix}`.replace(/^\//, '')
    : prefix;

  const keys: string[] = [];
  let token: string | undefined;

  do {
    const res = await client().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: searchPrefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) {
      const key = obj.Key ?? '';
      const rel = key.startsWith(prefix)
        ? key.slice(prefix.length).replace(/^\//, '')
        : key;
      if (rel) keys.push(rel);
    }
    token = res.NextContinuationToken;
  } while (token);

  return keys;
}

/**
 * List `.css` keys under a sub-prefix. Returns keys relative to the vault
 * prefix.
 *
 * Deliberately separate from `listObjects` (which is `.md`-only): theme
 * plugins are `.css`, and no portal write route can ever create a `.css`
 * key — every write forces `.md`. That keeps the theme source and the
 * user-writable content tree from overlapping. See `theme-registry.ts` and
 * the security note in `docs/theming.md`.
 */
export async function listCssObjects(subPrefix = ''): Promise<string[]> {
  trace('LIST css', subPrefix || '<root>');
  if (useMock) return mock.listCssObjects(subPrefix);
  const searchPrefix = subPrefix
    ? `${prefix}/${subPrefix}`.replace(/^\//, '')
    : prefix;

  const keys: string[] = [];
  let token: string | undefined;

  do {
    const res = await client().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: searchPrefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) {
      const key = obj.Key ?? '';
      const rel = key.startsWith(prefix)
        ? key.slice(prefix.length).replace(/^\//, '')
        : key;
      if (rel.endsWith('.css')) keys.push(rel);
    }
    token = res.NextContinuationToken;
  } while (token);

  return keys;
}

/** Fetch a single object by relative key. Returns UTF-8 content. */
export async function getObject(relKey: string): Promise<string> {
  trace('GET', relKey);
  if (useMock) return mock.getObject(relKey);
  const res = await client().send(
    new GetObjectCommand({ Bucket: bucket, Key: fullKey(relKey) }),
  );
  return (await res.Body?.transformToString('utf-8')) ?? '';
}

/** Fetch object metadata by relative key. */
export async function headObject(relKey: string): Promise<{ lastModified: Date | null }> {
  trace('HEAD', relKey);
  if (useMock) return mock.headObject(relKey);
  const res = await client().send(
    new HeadObjectCommand({ Bucket: bucket, Key: fullKey(relKey) }),
  );
  return { lastModified: res.LastModified ?? null };
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

/** Fetch object content and its ETag for optimistic concurrency. */
export async function getObjectWithETag(
  relKey: string,
): Promise<{ content: string; etag: string }> {
  trace('GET', `${relKey} (+etag)`);
  if (useMock) return mock.getObjectWithETag(relKey);
  const res = await client().send(
    new GetObjectCommand({ Bucket: bucket, Key: fullKey(relKey) }),
  );
  const content = (await res.Body?.transformToString('utf-8')) ?? '';
  const etag = res.ETag ?? '';
  return { content, etag };
}

/**
 * Content-type for a document write, derived from the key extension. Markdown is
 * the default; `.html` writes carry `text/html` so a direct S3/CDN fetch renders
 * correctly (plan 022). The portal itself dispatches on the extension, not this
 * header, so it is metadata-only for the app.
 */
function contentTypeForKey(relKey: string): string {
  return relKey.endsWith('.html')
    ? 'text/html; charset=utf-8'
    : 'text/markdown; charset=utf-8';
}

/** Write an object to S3. If ifMatch is provided, uses optimistic concurrency. Returns the new ETag. */
export async function putObject(
  relKey: string,
  body: string,
  ifMatch?: string,
): Promise<string> {
  trace('PUT', `${relKey} (${body.length} chars)${ifMatch ? ' if-match' : ''}`);
  if (useMock) {
    try {
      return await mock.putObject(relKey, body, ifMatch);
    } catch (err) {
      if (err instanceof mock.ConcurrencyError) throw new ConcurrencyError();
      throw err;
    }
  }
  try {
    const res = await client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: fullKey(relKey),
        Body: body,
        ContentType: contentTypeForKey(relKey),
        ...(ifMatch ? { IfMatch: ifMatch } : {}),
      }),
    );
    if (!res.ETag) throw new Error('S3 PutObject did not return an ETag');
    return res.ETag;
  } catch (err: unknown) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === 'PreconditionFailed' || e.$metadata?.httpStatusCode === 412) {
      throw new ConcurrencyError();
    }
    throw err;
  }
}

/** Create an object only if it does not already exist. Returns the new ETag. */
export async function putObjectIfAbsent(
  relKey: string,
  body: string,
): Promise<string> {
  trace('PUT', `${relKey} (${body.length} chars) if-absent`);
  if (useMock) {
    try {
      return await mock.putObjectIfAbsent(relKey, body);
    } catch (err) {
      if (err instanceof mock.ObjectAlreadyExistsError) throw new ObjectAlreadyExistsError();
      throw err;
    }
  }
  try {
    const res = await client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: fullKey(relKey),
        Body: body,
        ContentType: contentTypeForKey(relKey),
        IfNoneMatch: '*',
      }),
    );
    if (!res.ETag) throw new Error('S3 PutObject did not return an ETag');
    return res.ETag;
  } catch (err: unknown) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === 'PreconditionFailed' || e.$metadata?.httpStatusCode === 412) {
      throw new ObjectAlreadyExistsError();
    }
    throw err;
  }
}

/** Delete an object from S3. */
export async function deleteObject(relKey: string): Promise<void> {
  trace('DELETE', relKey);
  if (useMock) return mock.deleteObject(relKey);
  await client().send(
    new DeleteObjectCommand({ Bucket: bucket, Key: fullKey(relKey) }),
  );
}

/**
 * Server-side copy of one object (S3 CopyObject — no body round-trip through
 * the app). Used by `vault-ops.movePrefix` for two-phase, resumable moves.
 */
export async function copyObject(fromRel: string, toRel: string): Promise<void> {
  trace('COPY', `${fromRel} → ${toRel}`);
  if (useMock) return mock.copyObject(fromRel, toRel);
  await client().send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: fullKey(toRel),
      // CopySource is `bucket/key` and must be URL-encoded per SDK requirements.
      CopySource: encodeURIComponent(`${bucket}/${fullKey(fromRel)}`),
    }),
  );
}
