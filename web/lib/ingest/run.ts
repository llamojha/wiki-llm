import { getObject, putObject } from '@/lib/s3';
import { appendLog } from '@/lib/log-append';
import { planPages, type IngestPlan } from '@/lib/ingest/plan';
import { generatePages, type GeneratedPage } from '@/lib/ingest/generate';

export type CurationResult = {
  rawKey: string;
  plan: IngestPlan;
  pages: GeneratedPage[];
};

/**
 * Run the curation pipeline on a single raw file.
 * Does NOT regenerate indexes — caller is responsible for that after all files are processed.
 */
export async function runCuration(space: string, rawKey: string): Promise<CurationResult> {
  const rawContent = await getObject(rawKey);

  let indexContent = '';
  try {
    indexContent = await getObject(`${space}/index.md`);
  } catch { /* no index yet */ }

  const plan = await planPages(rawContent, indexContent, rawKey, space);

  if (plan.pages.length === 0) {
    return { rawKey, plan, pages: [] };
  }

  const pages = await generatePages(plan, rawContent, rawKey, space);

  for (const page of pages) {
    await putObject(page.key, page.content);
  }

  await appendLog('curated', rawKey, `Generated ${pages.length} page(s) in ${space}`);

  return { rawKey, plan, pages };
}
