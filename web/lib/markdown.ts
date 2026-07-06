import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

import { rehypeFilterDataImages, rehypeFilterStyles, vaultSanitizeSchema } from '@/lib/sanitize-schema';
import type { SanitizedHtml } from '@/lib/types';
import { rehypeVaultLinks } from '@/lib/vault-links';

// Use the shared sanitize schema (web/lib/sanitize-schema.ts) — the single
// sanitizer configuration for the entire codebase. Extends GitHub's default
// with inline styles (denylist-filtered) and size-bounded data:image/* URIs.
// rehype-slug adds id attributes to headings for anchor links.
// remark-frontmatter recognizes leading `---\n…\n---` YAML blocks so they
// don't render as visible text (and aren't mistaken for thematic breaks).

function buildProcessor(imageProxy: boolean) {
  return unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml', 'toml'])
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeSanitize, vaultSanitizeSchema)
    .use(rehypeFilterStyles)
    .use(rehypeFilterDataImages)
    .use(rehypeVaultLinks, { imageProxy })
    .use(rehypeStringify);
}

// Pre-built pipelines — one per mode. Avoid constructing a new processor per call.
const processorDefault = buildProcessor(false);
const processorWithProxy = buildProcessor(true);

export interface RenderMarkdownOptions {
  /** When true, external images are rewritten to /api/image-proxy. */
  imageProxy?: boolean;
}

/**
 * Render a Markdown string to sanitized HTML.
 * Returns a SanitizedHtml branded type — the only way to produce a value
 * accepted by LiveDoc._html and DocReader's dangerouslySetInnerHTML.
 */
export async function renderMarkdown(
  raw: string,
  options?: RenderMarkdownOptions,
): Promise<SanitizedHtml> {
  const processor = options?.imageProxy ? processorWithProxy : processorDefault;
  const result = await processor.process(raw);
  return String(result) as SanitizedHtml;
}
