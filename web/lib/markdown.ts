import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

import { isEnabled } from '@/lib/flags';
import { rehypeFilterDataImages, rehypeFilterStyles, vaultSanitizeSchema } from '@/lib/sanitize-schema';
import type { SanitizedHtml } from '@/lib/types';
import { rehypeVaultLinks } from '@/lib/vault-links';

// Use the shared sanitize schema (web/lib/sanitize-schema.ts) — the single
// sanitizer configuration for the entire codebase. Extends GitHub's default
// with inline styles (denylist-filtered) and size-bounded data:image/* URIs.
// rehype-slug adds id attributes to headings for anchor links.
// remark-frontmatter recognizes leading `---\n…\n---` YAML blocks so they
// don't render as visible text (and aren't mistaken for thematic breaks).
const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml', 'toml'])
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSlug)
  .use(rehypeSanitize, vaultSanitizeSchema)
  // Post-sanitize transforms: filter dangerous CSS values and oversized/non-image data URIs.
  .use(rehypeFilterStyles)
  .use(rehypeFilterDataImages)
  // After sanitize so the transform operates on already-trusted nodes and the
  // output stays within the SanitizedHtml boundary.
  .use(rehypeVaultLinks, { imageProxy: isEnabled('imageProxy') })
  .use(rehypeStringify);

/**
 * Render a Markdown string to sanitized HTML.
 * Returns a SanitizedHtml branded type — the only way to produce a value
 * accepted by LiveDoc._html and DocReader's dangerouslySetInnerHTML.
 */
export async function renderMarkdown(raw: string): Promise<SanitizedHtml> {
  const result = await processor.process(raw);
  return String(result) as SanitizedHtml;
}
