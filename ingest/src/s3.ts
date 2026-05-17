import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const prefix = process.env.VAULT_PREFIX ?? '';
const region = process.env.VAULT_REGION ?? 'us-east-1';

let _client: S3Client | null = null;

function bucket(): string {
  const b = process.env.VAULT_BUCKET;
  if (!b) {
    console.error('VAULT_BUCKET env var required');
    process.exit(1);
  }
  return b;
}

function client(): S3Client {
  if (!_client) _client = new S3Client({ region });
  return _client;
}

function fullKey(relKey: string): string {
  return prefix ? `${prefix}/${relKey}`.replace(/^\//, '') : relKey;
}

/** List top-level folders (spaces) in the vault. */
export async function listSpaces(): Promise<string[]> {
  const res = await client().send(
    new ListObjectsV2Command({
      Bucket: bucket(),
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

/** List .md keys under a sub-prefix. Returns keys relative to vault prefix. */
export async function listObjects(subPrefix = ''): Promise<string[]> {
  const searchPrefix = subPrefix ? fullKey(subPrefix) : prefix;

  const keys: string[] = [];
  let token: string | undefined;

  do {
    const res = await client().send(
      new ListObjectsV2Command({
        Bucket: bucket(),
        Prefix: searchPrefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) {
      const key = obj.Key ?? '';
      const rel = prefix ? key.slice(prefix.length).replace(/^\//, '') : key;
      if (rel.endsWith('.md')) keys.push(rel);
    }
    token = res.NextContinuationToken;
  } while (token);

  return keys;
}

/** Fetch a single object by relative key. */
export async function getObject(relKey: string): Promise<string> {
  const res = await client().send(
    new GetObjectCommand({ Bucket: bucket(), Key: fullKey(relKey) }),
  );
  return (await res.Body?.transformToString('utf-8')) ?? '';
}

/** Write an object to S3. */
export async function putObject(relKey: string, body: string): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: fullKey(relKey),
      Body: body,
      ContentType: 'text/markdown; charset=utf-8',
    }),
  );
}

/** Check if an object exists. */
export async function objectExists(relKey: string): Promise<boolean> {
  try {
    await client().send(
      new HeadObjectCommand({ Bucket: bucket(), Key: fullKey(relKey) }),
    );
    return true;
  } catch {
    return false;
  }
}
