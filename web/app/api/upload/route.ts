import { NextResponse } from 'next/server';
import { putObject } from '@/lib/s3';

const SPACE_RE = /^[a-z0-9][a-z0-9-]*$/;

function sanitizeFilename(name: string): string {
  // Strip path separators, keep only the basename, ensure .md extension
  return name.replace(/[/\\]/g, '').replace(/[^a-zA-Z0-9._-]/g, '-');
}

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('file') as File | null;
  const space = form.get('space') as string | null;

  if (!file || !space) {
    return NextResponse.json({ detail: 'file and space are required' }, { status: 400 });
  }

  if (!SPACE_RE.test(space)) {
    return NextResponse.json(
      { detail: 'space must be lowercase alphanumeric with hyphens only' },
      { status: 400 },
    );
  }

  if (!file.name.endsWith('.md')) {
    return NextResponse.json({ detail: 'only .md files are accepted' }, { status: 400 });
  }

  const filename = sanitizeFilename(file.name);
  const key = `${space}/raw/${filename}`;
  const content = await file.text();

  try {
    await putObject(key, content);
  } catch {
    return NextResponse.json({ detail: 'S3 write failed' }, { status: 500 });
  }

  return NextResponse.json({ key, space }, { status: 201 });
}
