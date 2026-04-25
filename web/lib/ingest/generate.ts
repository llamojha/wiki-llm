import { converseWithTool, type ToolSchema } from '@/lib/ingest/bedrock';
import { getObject } from '@/lib/s3';
import type { IngestPlan, PagePlanEntry } from '@/lib/ingest/plan';

export type GeneratedPage = {
  key: string;
  title: string;
  content: string;
};

type PageOutput = {
  title: string;
  tags: string[];
  body: string;
};

const CONCURRENCY = 3;

const GENERATE_TOOL: ToolSchema = {
  name: 'submit_page',
  description: 'Submit the generated wiki page content',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Page title' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Relevant tags' },
      body: { type: 'string', description: 'Full Markdown body (no frontmatter — added automatically)' },
    },
    required: ['title', 'tags', 'body'],
  },
};

function systemPromptFor(entry: PagePlanEntry): string {
  const desc: Record<string, string> = {
    source: 'a structured summary page that captures the key information from the source document',
    entity: 'a wiki page about a specific person, organization, product, or service',
    concept: 'a wiki page explaining a key idea, framework, or technical concept',
  };

  return `You are a wiki maintainer. Generate ${desc[entry.type]}.

Title: "${entry.title}"
Description: ${entry.description}

Rules:
- Write clear, well-structured Markdown
- Use h2 (##) and h3 (###) headings to organize content
- Be factual and concise — synthesize, don't just copy
- Do NOT include YAML frontmatter — it will be added automatically
- Output only the Markdown body content`;
}

function buildFrontmatter(entry: PagePlanEntry, tags: string[], rawKey: string): string {
  const now = new Date().toISOString();
  const safeTitle = entry.title.replace(/"/g, '\\"');
  return [
    '---',
    `title: "${safeTitle}"`,
    `type: ${entry.type}`,
    `source_type: generated`,
    `sources: ["${rawKey}"]`,
    `tags: [${tags.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(', ')}]`,
    `created: ${now}`,
    `updated: ${now}`,
    '---',
  ].join('\n');
}

async function generateOne(
  entry: PagePlanEntry,
  rawContent: string,
  rawKey: string,
  space: string,
): Promise<GeneratedPage> {
  const system = systemPromptFor(entry);
  let userMessage = `Source file: ${rawKey}\n\n--- SOURCE CONTENT ---\n${rawContent}\n--- END SOURCE ---`;

  if (entry.action === 'update' && entry.existingPath) {
    try {
      const existing = await getObject(entry.existingPath);
      userMessage += `\n\n--- EXISTING PAGE (to update) ---\n${existing}\n--- END EXISTING ---`;
    } catch { /* treat as create */ }
  }

  userMessage += `\n\nGenerate the ${entry.type} page: "${entry.title}"`;

  const result = await converseWithTool<PageOutput>(system, userMessage, GENERATE_TOOL);
  const frontmatter = buildFrontmatter(entry, result.tags ?? [], rawKey);
  const content = `${frontmatter}\n\n${result.body}\n`;

  return { key: `${space}/${entry.path}`, title: entry.title, content };
}

async function parallel<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  async function next(): Promise<void> {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
  return results;
}

export async function generatePages(
  plan: IngestPlan,
  rawContent: string,
  rawKey: string,
  space: string,
): Promise<GeneratedPage[]> {
  return parallel(plan.pages, CONCURRENCY, (entry) =>
    generateOne(entry, rawContent, rawKey, space),
  );
}
