import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

const region = process.env.VAULT_REGION ?? 'eu-central-1';
let _client: S3Client | null = null;

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

export async function putObject(bucket: string, prefix: string, key: string, body: string): Promise<void> {
  await client().send(new PutObjectCommand({
    Bucket: bucket,
    Key: fullKey(prefix, key),
    Body: body,
    ContentType: 'text/markdown; charset=utf-8',
  }));
}

export async function putJson(bucket: string, prefix: string, key: string, data: unknown): Promise<void> {
  await client().send(new PutObjectCommand({
    Bucket: bucket,
    Key: fullKey(prefix, key),
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json',
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
