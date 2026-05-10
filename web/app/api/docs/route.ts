import matter from 'gray-matter';
import { NextResponse } from 'next/server';

import { regenerateMasterIndex, regenerateSpaceIndex } from '@/lib/index-gen';
import { appendLog } from '@/lib/log-append';
import { getObject, putObject } from '@/lib/s3';
import { invalidateSearchIndex } from '@/lib/search';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { title, body: content, slug } = body as {
    title?: string;
    body?: string;
    slug?: string;
  };

  if (!title || !content) {
    return NextResponse.json(
      { detail: 'title and body are required' },
      { status: 400 },
    );
  }

  const docSlug = slug || slugify(title);
  const key = `wiki/${docSlug}.md`;

  // Check if slug already exists
  try {
    await getObject(key);
    return NextResponse.json(
      { detail: `A page with slug "${docSlug}" already exists` },
      { status: 409 },
    );
  } catch {
    // Key doesn't exist — good, proceed
  }

  const fm = {
    title,
    source_type: 'authored',
    author: 'you',
    updated: new Date().toISOString(),
    starred: false,
  };

  const markdown = matter.stringify(content, fm);
  await putObject(key, markdown);
  if (key.includes('/')) {
    const space = key.split('/')[0];
    await regenerateSpaceIndex(space);
  }
  await regenerateMasterIndex();
  await appendLog('created', key, title);
  invalidateSearchIndex();

  return NextResponse.json({ id: key, title, path: key }, { status: 201 });
}
