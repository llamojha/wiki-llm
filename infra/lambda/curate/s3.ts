import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

const region = process.env.S3_REGION ?? process.env.VAULT_REGION ?? 'us-east-1';
let _client: S3Client | null = null;

/**
 * Thrown by `putJson` when a conditional (`ifMatch`) write is rejected because
 * the object changed since it was read — HTTP 412 / `PreconditionFailed`.
 * Mirrors the web app's `ConcurrencyError` (web/lib/s3.ts) so the manifest
 * compare-and-swap loop reads the same on both sides of the codebase.
 */
export class ManifestConflictError extends Error {
  constructor(message = 'PreconditionFailed') {
    super(message);
    this.name = 'ManifestConflictError';
  }
}

function client(): S3Client {
  if (!_client) _client = new S3Client({ region });
  return _client;
}

function fullKey(prefix: string, key: string): string {
  return prefix ? `${prefix}/${key}` : key;
}

export async function getObject(bucket: string, prefix: string, key: string): Promise<string> {
  const res = await client().send(new GetObjectCommand({
    Bucket: bucket,
    Key: fullKey(prefix, key),
  }));
  return await res.Body!.transformToString('utf-8');
}

export async function getObjectOrNull(bucket: string, prefix: string, key: string): Promise<string | null> {
  try {
    return await getObject(bucket, prefix, key);
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'NoSuchKey') return null;
    throw err;
  }
}

/**
 * Fetch an object with its ETag, or `null` if it doesn't exist. The ETag feeds
 * `putJson`'s `ifMatch` for compare-and-swap manifest writes.
 */
export async function getObjectWithETagOrNull(
  bucket: string,
  prefix: string,
  key: string,
): Promise<{ content: string; etag: string } | null> {
  try {
    const res = await client().send(new GetObjectCommand({
      Bucket: bucket,
      Key: fullKey(prefix, key),
    }));
    return {
      content: await res.Body!.transformToString('utf-8'),
      etag: res.ETag ?? '',
    };
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'NoSuchKey') return null;
    throw err;
  }
}

export async function putObject(bucket: string, prefix: string, key: string, body: string): Promise<void> {
  await client().send(new PutObjectCommand({
    Bucket: bucket,
    Key: fullKey(prefix, key),
    Body: body,
    ContentType: 'text/markdown; charset=utf-8',
  }));
}

export async function putJson(
  bucket: string,
  prefix: string,
  key: string,
  data: unknown,
  ifMatch?: string,
): Promise<void> {
  try {
    await client().send(new PutObjectCommand({
      Bucket: bucket,
      Key: fullKey(prefix, key),
      Body: JSON.stringify(data, null, 2),
      ContentType: 'application/json',
      ...(ifMatch ? { IfMatch: ifMatch } : {}),
    }));
  } catch (err: unknown) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === 'PreconditionFailed' || e.$metadata?.httpStatusCode === 412) {
      throw new ManifestConflictError();
    }
    throw err;
  }
}

export async function copyObject(bucket: string, prefix: string, srcKey: string, dstKey: string): Promise<void> {
  await client().send(new CopyObjectCommand({
    Bucket: bucket,
    CopySource: encodeURIComponent(`${bucket}/${fullKey(prefix, srcKey)}`),
    Key: fullKey(prefix, dstKey),
  }));
}

export async function deleteObject(bucket: string, prefix: string, key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({
    Bucket: bucket,
    Key: fullKey(prefix, key),
  }));
}

export async function listObjects(bucket: string, prefix: string, keyPrefix: string): Promise<string[]> {
  const fullPrefix = prefix ? `${prefix}/${keyPrefix}` : keyPrefix;
  const keys: string[] = [];
  let token: string | undefined;

  do {
    const res = await client().send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: fullPrefix,
      ContinuationToken: token,
    }));
    for (const obj of res.Contents ?? []) {
      if (obj.Key) {
        // Strip the vault prefix to return relative keys
        const rel = prefix ? obj.Key.slice(prefix.length + 1) : obj.Key;
        keys.push(rel);
      }
    }
    token = res.NextContinuationToken;
  } while (token);

  return keys;
}
