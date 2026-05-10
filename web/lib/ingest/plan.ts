import { converseWithTool, type ToolSchema } from '@/lib/ingest/bedrock';

export type PagePlanEntry = {
  path: string;
  type: 'source' | 'entity' | 'concept';
  title: string;
  description: string;
  action: 'create' | 'update';
  existingPath?: string;
};

export type IngestPlan = {
  pages: PagePlanEntry[];
};

const PLAN_SYSTEM = `You are a wiki maintainer for a Markdown knowledge base organized into spaces.

Analyze the provided source document and plan which structured wiki pages should be created or updated within this space.

For each source document, produce:
1. Exactly ONE source page (type: "source") — a structured summary of the document
2. Zero or more entity pages (type: "entity") — for significant people, organizations, products, or services mentioned
3. Zero or more concept pages (type: "concept") — for key ideas, frameworks, or technical concepts

Rules:
- The "path" field is the relative path within the space (e.g., "people/john-doe.md", "concepts/event-sourcing.md", "summary.md")
- Use subfolders to organize by category when it makes sense (people/, concepts/, etc.)
- Path must be lowercase, hyphens for spaces, .md extension, max 60 chars
- If a page already exists in the space index (provided below), set action to "update" and include existingPath
- Only create entity/concept pages for things substantive enough to warrant their own page
- Prefer fewer, higher-quality pages over many thin ones`;

const PLAN_TOOL: ToolSchema = {
  name: 'submit_plan',
  description: 'Submit the ingest plan — list of pages to create or update in this space',
  inputSchema: {
    type: 'object',
    properties: {
      pages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path within the space (e.g., "people/john-doe.md")' },
            type: { type: 'string', enum: ['source', 'entity', 'concept'] },
            title: { type: 'string', description: 'Human-readable page title' },
            description: { type: 'string', description: 'Brief description of what this page will cover' },
            action: { type: 'string', enum: ['create', 'update'] },
            existingPath: { type: 'string', description: 'Full path of existing page if action is update' },
          },
          required: ['path', 'type', 'title', 'description', 'action'],
        },
      },
    },
    required: ['pages'],
  },
};

export async function planPages(
  rawContent: string,
  indexContent: string,
  rawKey: string,
  space: string,
): Promise<IngestPlan> {
  const userMessage = `Space: ${space}
Source file: ${rawKey}

--- SOURCE CONTENT ---
${rawContent}
--- END SOURCE ---

Current space index (existing pages in "${space}"):
${indexContent || '(empty — first ingest in this space)'}

Analyze this source and submit your plan for pages to create/update in the "${space}" space.`;

  const result = await converseWithTool<IngestPlan>(PLAN_SYSTEM, userMessage, PLAN_TOOL);

  if (!result.pages || !Array.isArray(result.pages)) {
    throw new Error('Plan call returned invalid structure: missing pages array');
  }

  return result;
}
