/**
 * S3 client facade — dispatches to either the real AWS S3 implementation or
 * the in-memory mock (`s3-mock.ts`) based on `MOCK_S3=1`.
 *
 * The mock path is used by Playwright e2e tests so the full Next.js + API
 * route stack can be exercised without touching AWS. In all other contexts
 * (dev, prod) this re-exports the real boto3-backed implementation.
 */

import {
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

/** List top-level folders (spaces) in the vault. */
export async function listSpaces(): Promise<string[]> {
  if (useMock) return mock.listSpaces();
  const res = await client().send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix ? `${prefix}/` : '',
      Delimiter: '/',
    }),
  );
  return (res.CommonPrefixes ?? [])
    .map((p) => {
      const full = p.Prefix ?? '';
      const rel = prefix ? full.slice(prefix.length + 1) : full;
      return rel.replace(/\/$/, '');
    })
    .filter((s) => s.length > 0);
}

/** List all .md keys under the vault prefix. Returns keys relative to prefix. */
export async function listObjects(subPrefix = ''): Promise<string[]> {
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
      if (rel.endsWith('.md')) keys.push(rel);
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
  if (useMock) return mock.getObject(relKey);
  const res = await client().send(
    new GetObjectCommand({ Bucket: bucket, Key: fullKey(relKey) }),
  );
  return (await res.Body?.transformToString('utf-8')) ?? '';
}

/** Fetch object metadata by relative key. */
export async function headObject(relKey: string): Promise<{ lastModified: Date | null }> {
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
  if (useMock) return mock.getObjectWithETag(relKey);
  const res = await client().send(
    new GetObjectCommand({ Bucket: bucket, Key: fullKey(relKey) }),
  );
  const content = (await res.Body?.transformToString('utf-8')) ?? '';
  const etag = res.ETag ?? '';
  return { content, etag };
}

/** Write an object to S3. If ifMatch is provided, uses optimistic concurrency. Returns the new ETag. */
export async function putObject(
  relKey: string,
  body: string,
  ifMatch?: string,
): Promise<string> {
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
        ContentType: 'text/markdown; charset=utf-8',
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
        ContentType: 'text/markdown; charset=utf-8',
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
  if (useMock) return mock.deleteObject(relKey);
  await client().send(
    new DeleteObjectCommand({ Bucket: bucket, Key: fullKey(relKey) }),
  );
}
