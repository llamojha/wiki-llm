import { NextResponse } from 'next/server';

import { getObject } from '@/lib/s3';
import { converseWithTool, type ToolSchema } from '@/lib/ingest/bedrock';
import { getStructure, ensureSpaceInStructure } from '@/lib/vault-structure';

const ASSIGN_TOOL: ToolSchema = {
  name: 'assign_space',
  description: 'Assign this document to an existing or new space',
  inputSchema: {
    type: 'object',
    properties: {
      space: { type: 'string', description: 'Lowercase space name (a-z0-9 and hyphens only, max 30 chars)' },
      reason: { type: 'string', description: 'Brief reason for the assignment' },
    },
    required: ['space', 'reason'],
  },
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { key, space } = body as { key?: string; space?: string };

  if (!key) {
    return NextResponse.json({ detail: 'key is required' }, { status: 400 });
  }

  // If space is already known (file is under {space}/raw/), just confirm it
  if (space && space !== '__all') {
    await ensureSpaceInStructure(space);
    return NextResponse.json({ space, reason: 'Explicitly provided' });
  }

  // Read file content for LLM assignment
  const rawContent = await getObject(key);
  const structure = await getStructure();
  const spaceList = structure.spaces.map(s => `- ${s.name}: ${s.label}`).join('\n') || '(no spaces yet)';

  const system = `You assign documents to spaces in a knowledge base. Pick the best existing space or create a new one.
Rules:
- Space names: lowercase, a-z0-9 and hyphens only, max 30 chars
- Prefer existing spaces when the content fits
- Only create a new space if the content clearly doesn't belong anywhere existing`;

  const userMsg = `Existing spaces:\n${spaceList}\n\nDocument: ${key}\nFirst 500 chars:\n${rawContent.slice(0, 500)}\n\nWhich space should this go in?`;

  const result = await converseWithTool<{ space: string; reason: string }>(system, userMsg, ASSIGN_TOOL);
  const assigned = result.space.replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'general';

  await ensureSpaceInStructure(assigned);

  return NextResponse.json({ space: assigned, reason: result.reason });
}
