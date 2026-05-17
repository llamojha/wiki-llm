import { deleteObject, getObject, putObject } from '@/lib/s3';
import { appendLog } from '@/lib/log-append';
import { planPages, type IngestPlan } from '@/lib/ingest/plan';
import { generatePages, type GeneratedPage } from '@/lib/ingest/generate';
import { converseWithTool, type ToolSchema } from '@/lib/ingest/bedrock';
import { getStructure, ensureSpaceInStructure } from '@/lib/vault-structure';

export type CurationResult = {
  rawKey: string;
  space: string;
  plan: IngestPlan;
  pages: GeneratedPage[];
};

const ASSIGN_TOOL: ToolSchema = {
  name: 'assign_space',
  description: 'Assign this document to an existing or new space',
  inputSchema: {
    type: 'object',
    properties: {
      space: { type: 'string', description: 'Lowercase space name (a-z0-9 and hyphens)' },
      reason: { type: 'string', description: 'Brief reason for the assignment' },
    },
    required: ['space', 'reason'],
  },
};

async function resolveSpace(rawContent: string, rawKey: string): Promise<string> {
  const structure = await getStructure();
  const spaceList = structure.spaces.map(s => `- ${s.name}: ${s.label}`).join('\n') || '(no spaces yet)';

  const system = `You assign documents to spaces in a knowledge base. Pick the best existing space or create a new one.
Rules:
- Space names: lowercase, a-z0-9 and hyphens only, max 30 chars
- Prefer existing spaces when the content fits
- Only create a new space if the content clearly doesn't belong anywhere existing`;

  const userMsg = `Existing spaces:\n${spaceList}\n\nDocument: ${rawKey}\nFirst 500 chars:\n${rawContent.slice(0, 500)}\n\nWhich space should this go in?`;

  const result = await converseWithTool<{ space: string }>(system, userMsg, ASSIGN_TOOL);
  return result.space.replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'general';
}

/**
 * Run the curation pipeline on a single raw file.
 * If space is empty, uses LLM to assign one based on content and existing structure.
 * Does NOT regenerate indexes — caller is responsible for that after all files are processed.
 */
export async function runCuration(space: string, rawKey: string): Promise<CurationResult> {
  const rawContent = await getObject(rawKey);

  // Resolve space for root-level raw files
  if (!space || space === '__all') {
    space = await resolveSpace(rawContent, rawKey);
    await ensureSpaceInStructure(space);
  }

  let indexContent = '';
  try {
    indexContent = await getObject(`${space}/index.md`);
  } catch { /* no index yet */ }

  const plan = await planPages(rawContent, indexContent, rawKey, space);

  if (plan.pages.length === 0) {
    return { rawKey, space, plan, pages: [] };
  }

  const pages = await generatePages(plan, rawContent, rawKey, space);

  for (const page of pages) {
    await putObject(page.key, page.content);
  }

  await appendLog('curated', rawKey, `Generated ${pages.length} page(s) in ${space}`);
  await deleteObject(rawKey);

  return { rawKey, space, plan, pages };
}
