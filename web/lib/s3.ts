import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

if (!process.env.VAULT_BUCKET) throw new Error('VAULT_BUCKET env var required');

const bucket = process.env.VAULT_BUCKET;
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

/** List all .md keys under the vault prefix. Returns keys relative to prefix. */
export async function listObjects(subPrefix = ''): Promise<string[]> {
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

/** Fetch a single object by relative key. Returns UTF-8 content. */
export async function getObject(relKey: string): Promise<string> {
  const res = await client().send(
    new GetObjectCommand({ Bucket: bucket, Key: fullKey(relKey) }),
  );
  return (await res.Body?.transformToString('utf-8')) ?? '';
}

export class ConcurrencyError extends Error {
  constructor(message = 'PreconditionFailed') {
    super(message);
    this.name = 'ConcurrencyError';
  }
}

/** Fetch object content and its ETag for optimistic concurrency. */
export async function getObjectWithETag(
  relKey: string,
): Promise<{ content: string; etag: string }> {
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

/** Delete an object from S3. */
export async function deleteObject(relKey: string): Promise<void> {
  await client().send(
    new DeleteObjectCommand({ Bucket: bucket, Key: fullKey(relKey) }),
  );
}
