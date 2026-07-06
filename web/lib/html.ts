import rehypeParse from 'rehype-parse';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';

import type { SanitizedHtml } from '@/lib/types';
import { rehypeVaultLinks } from '@/lib/vault-links';

/**
 * First-class HTML document support — the sanitizer spike for plan 022.
 *
 * HTML is the product's most guarded surface (the sanitize-everything
 * discipline exists because rendered HTML is where XSS lives). This module
 * reuses `rehype-sanitize` — the SAME trust boundary as `renderMarkdown` — so
 * there is exactly one sanitizer in the codebase. HTML docs earn the
 * `SanitizedHtml` brand via `rehype-parse → sanitize → stringify`, never by
 * bypassing it. NOT wired to any route yet (design-stage; see
 * `specs/html-documents.md`).
 *
 * Permanently out (sanitized away, never deferred): scripts, iframes,
 * object/embed, event-handler attributes, `javascript:` URLs, style tags.
 */

/** Minimal structural view of a hast node — avoids a direct `hast` type dep. */
interface HNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: HNode[];
}

const parser = unified().use(rehypeParse);

function parse(raw: string): HNode {
  return parser.parse(raw) as unknown as HNode;
}

/** Depth-first search for the first element with the given tag name. */
function findElement(node: HNode, tagName: string): HNode | null {
  if (node.tagName === tagName) return node;
  for (const child of node.children ?? []) {
    const found = findElement(child, tagName);
    if (found) return found;
  }
  return null;
}

/** Concatenated text content, skipping script/style bodies. */
function textOf(node: HNode): string {
  if (node.type === 'text') return node.value ?? '';
  if (node.tagName === 'script' || node.tagName === 'style') return '';
  return (node.children ?? []).map(textOf).join('');
}

/**
 * Lift a parsed document's `<body>` children to the tree root, dropping
 * `<html>`/`<head>`/`<title>`/doctype. Runs before sanitize so only body
 * content is rendered. Full-document and fragment inputs both flow through:
 * a fragment with no `<body>` is left untouched.
 */
function extractBody() {
  return (tree: HNode): void => {
    const html = (tree.children ?? []).find((n) => n.tagName === 'html');
    const body = (html?.children ?? []).find((n) => n.tagName === 'body');
    if (body?.children) tree.children = body.children;
  };
}

const renderer = unified()
  .use(rehypeParse)
  .use(extractBody)
  .use(rehypeSanitize)
  // After sanitize: rewrite in-vault links, strip external images. Shared with
  // the Markdown pipeline so there is exactly one in-vault link resolver.
  .use(rehypeVaultLinks)
  .use(rehypeStringify);

/**
 * Render a raw HTML document to sanitized, body-only HTML. Returns the
 * `SanitizedHtml` brand — the only value accepted by DocReader's
 * `dangerouslySetInnerHTML`.
 */
export async function renderHtmlDocument(raw: string): Promise<SanitizedHtml> {
  const result = await renderer.process(raw);
  return String(result) as SanitizedHtml;
}

/** Extract a document title: `<title>` first, then the first `<h1>`. */
export function htmlTitle(raw: string): string | null {
  const tree = parse(raw);
  const title = textOf(findElement(tree, 'title') ?? { type: 'root' }).trim();
  if (title) return title;
  const h1 = textOf(findElement(tree, 'h1') ?? { type: 'root' }).trim();
  return h1 || null;
}

/** Plain-text extraction for search snippets — via the parse tree, not regex. */
export function htmlText(raw: string, maxChars = 200): string {
  return textOf(parse(raw)).replace(/\s+/g, ' ').trim().slice(0, maxChars);
}
