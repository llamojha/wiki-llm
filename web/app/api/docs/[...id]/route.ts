import matter from 'gray-matter';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';

import { getObject } from '@/lib/s3';

function keyToTitle(key: string): string {
  const stem = key.split('/').pop()!.replace(/\.md$/, '');
  return stem.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string[] }> },
) {
  const { id } = await params;
  const key = decodeURIComponent(id.join('/'));

  let raw: string;
  try {
    raw = await getObject(key);
  } catch {
    return NextResponse.json({ detail: `Document not found: ${key}` }, { status: 404 });
  }

  const { data: fm } = matter(raw);
  const prefix = process.env.VAULT_PREFIX ?? '';
  const s3Key = prefix ? `${prefix}/${key}`.replace(/^\//, '') : key;

  const doc = {
    id: key,
    title: (fm.title as string) || keyToTitle(key),
    path: key.replace(/\.md$/, '').split('/').join(' / '),
    s3_key: s3Key,
    source_type: (fm.source_type as string) || (key.startsWith('generated/') ? 'generated' : 'authored'),
    updated: (fm.updated as string) ?? '',
    author: (fm.author as string) ?? 'unknown',
    tags: Array.isArray(fm.tags) ? fm.tags : fm.tags ? [String(fm.tags)] : [],
    checksum: createHash('md5').update(raw).digest('hex'),
    raw_markdown: raw,
  };

  return NextResponse.json(doc);
}
