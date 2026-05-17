import { converseWithTool, type ToolSchema } from './bedrock.js';
import { getObject } from './s3.js';
import type { IngestPlan, PagePlanEntry } from './plan.js';

export type GeneratedPage = {
  key: string; // Full space-relative S3 key (e.g., "articles/people/john-doe.md")
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
  const typeDescriptions: Record<string, string> = {
    source: 'a structured summary page that captures the key information from the source document',
    entity: 'a wiki page about a specific person, organization, product, or service',
    concept: 'a wiki page explaining a key idea, framework, or technical concept',
  };

  return `You are a wiki maintainer. Generate ${typeDescriptions[entry.type]}.

Title: "${entry.title}"
Description: ${entry.description}

Rules:
- Write clear, well-structured Markdown
- Use h2 (##) and h3 (###) headings to organize content
- Be factual and concise — synthesize, don't just copy
- Reference related concepts/entities by name where relevant
- Do NOT include YAML frontmatter — it will be added automatically
- Output only the Markdown body content`;
}

function buildFrontmatter(entry: PagePlanEntry, tags: string[], rawKey: string): string {
  const now = new Date().toISOString();
  const lines = [
    '---',
    `title: "${entry.title}"`,
    `type: ${entry.type}`,
    `source_type: generated`,
    `sources: ["${rawKey}"]`,
    `tags: [${tags.map((t) => `"${t}"`).join(', ')}]`,
    `created: ${now}`,
    `updated: ${now}`,
    '---',
  ];
  return lines.join('\n');
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
    } catch {
      // Existing page not found — treat as create
    }
  }

  userMessage += `\n\nGenerate the ${entry.type} page: "${entry.title}"`;

  const result = await converseWithTool<PageOutput>(system, userMessage, GENERATE_TOOL);
  const frontmatter = buildFrontmatter(entry, result.tags ?? [], rawKey);
  const content = `${frontmatter}\n\n${result.body}\n`;
  const key = `${space}/${entry.path}`;

  return { key, content };
}

/** Run generation calls in parallel with concurrency limit. */
async function parallel<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;

  async function next(): Promise<void> {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => next());
  await Promise.all(workers);
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
