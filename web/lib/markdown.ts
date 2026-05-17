import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import type { SanitizedHtml } from '@/lib/types';

// Use default sanitization schema — safe HTML only, no scripts or event handlers.
// rehype-sanitize strips unsafe tags/attributes by default.
// rehype-slug adds id attributes to headings for anchor links.
// remark-frontmatter recognizes leading `---\n…\n---` YAML blocks so they
// don't render as visible text (and aren't mistaken for thematic breaks).
const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml', 'toml'])
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSlug)
  .use(rehypeSanitize)
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
