import { putObject } from './s3.js';
import type { GeneratedPage } from './generate.js';

/** Write all generated pages to S3. */
export async function writePages(pages: GeneratedPage[]): Promise<void> {
  for (const page of pages) {
    await putObject(page.key, page.content);
  }
}
