import { withBasePath } from '@/lib/base-path';

/**
 * Shared in-vault link resolver — one rehype transform used by BOTH the Markdown
 * (`markdown.ts`) and HTML (`html.ts`) render pipelines (plan 022). It:
 *
 *  - rewrites **relative in-vault document links** (`notes/foo.md`,
 *    `guides/setup.html`) to portal doc routes (`/[...id]`), so a link authored
 *    against the vault key resolves to the reader instead of 404ing; and
 *  - strips **external `<img>`** so a document being read makes no outbound
 *    requests (an SSRF/privacy footgun).
 *
 * It runs after `rehype-sanitize`, before `rehype-stringify`, so the output
 * stays within the `SanitizedHtml` trust boundary. Recognition is by URL shape,
 * NOT `isDocumentKey`: these pipelines execute client-side, where the vault mode
 * is not resolved — a relative path ending in `.md`/`.html` is an in-vault doc
 * link in either mode, so shape is both sufficient and correct.
 */

/** Minimal structural view of a hast node (avoids a direct `hast` type dep). */
interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const DOC_EXT = /\.(md|html)(?:$|[?#])/i;

/** A URL with a scheme (`http:`, `mailto:`, `data:`) or protocol-relative (`//`). */
function isExternal(url: string): boolean {
  return /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url);
}

/** A relative link pointing at an in-vault document (`.md`/`.html`). */
function isInVaultDocLink(url: string): boolean {
  if (!url) return false;
  // App-absolute (`/…`), fragment (`#…`), query (`?…`) and external links are
  // left untouched — only same-vault relative paths are rewritten.
  if (url.startsWith('/') || url.startsWith('#') || url.startsWith('?')) return false;
  if (isExternal(url)) return false;
  return DOC_EXT.test(url);
}

function transform(node: HastNode): void {
  if (!node.children) return;
  // Drop external images (no outbound requests from a doc being read).
  node.children = node.children.filter((child) => {
    if (child.tagName === 'img') {
      const src = String(child.properties?.src ?? '');
      if (isExternal(src)) return false;
    }
    return true;
  });
  for (const child of node.children) {
    if (child.tagName === 'a' && child.properties) {
      const href = String(child.properties.href ?? '');
      if (isInVaultDocLink(href)) {
        child.properties.href = withBasePath(`/${href.replace(/^\.?\//, '')}`);
      }
    }
    transform(child);
  }
}

/** rehype plugin: rewrite in-vault links + strip external images. */
export function rehypeVaultLinks() {
  return (tree: HastNode): void => transform(tree);
}
