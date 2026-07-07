import { withBasePath } from '@/lib/base-path';

/**
 * Shared in-vault link resolver — one rehype transform used by BOTH the Markdown
 * (`markdown.ts`) and HTML (`html.ts`) render pipelines (plan 022). It:
 *
 *  - rewrites **relative in-vault document links** (`notes/foo.md`,
 *    `guides/setup.html`) to portal doc routes (`/[...id]`), so a link authored
 *    against the vault key resolves to the reader instead of 404ing; and
 *  - strips **external `<img>`** (or rewrites them to the image proxy when
 *    `FEATURE_IMAGE_PROXY` is enabled) so a document being read makes no
 *    outbound requests from the client browser.
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

export interface VaultLinksOptions {
  /** When true, external images are rewritten to the image proxy instead of stripped. */
  imageProxy?: boolean;
}

const DOC_EXT = /\.(md|html)(?:$|[?#])/i;

/** A URL with a scheme (`http:`, `mailto:`) or protocol-relative (`//`). */
function isExternal(url: string): boolean {
  // `data:` URIs are inline content, not external network requests — do not strip them.
  if (/^data:/i.test(url)) return false;
  return /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url);
}

/**
 * Split a relative URL into path, query, and fragment components.
 * E.g. `notes/setup.md?v=2#install` → { path: 'notes/setup.md', suffix: '?v=2#install' }
 */
function splitUrl(url: string): { path: string; suffix: string } {
  const qIdx = url.indexOf('?');
  const hIdx = url.indexOf('#');
  let splitAt = url.length;
  if (qIdx !== -1) splitAt = qIdx;
  if (hIdx !== -1 && hIdx < splitAt) splitAt = hIdx;
  return { path: url.slice(0, splitAt), suffix: url.slice(splitAt) };
}

/** A relative link pointing at an in-vault document (`.md`/`.html`). */
function isInVaultDocLink(url: string): boolean {
  if (!url) return false;
  // App-absolute (`/…`), fragment-only (`#…`), query-only (`?…`), and external
  // links are left untouched — only same-vault relative paths are rewritten.
  if (url.startsWith('/') || url.startsWith('#') || url.startsWith('?')) return false;
  if (isExternal(url)) return false;
  return DOC_EXT.test(url);
}

/**
 * Normalize a relative path: strip leading `./` and collapse `../` segments.
 * Does not resolve against a base (we don't have one in the transform context);
 * just cleans the relative prefix so the portal route can resolve it.
 */
function normalizePath(raw: string): string {
  let path = raw;
  // Strip leading ./
  path = path.replace(/^\.\//, '');
  // Collapse ../segments — since we don't know the current doc's path in this
  // transform, we strip `../` prefixes (they navigate "up" in the vault tree).
  // The portal's catch-all route will resolve the path as-is against the vault root.
  path = path.replace(/^(\.\.\/)+/, '');
  return path;
}

function createTransform(options: VaultLinksOptions) {
  const transform = (node: HastNode): void => {
    if (!node.children) return;
    // Handle external images: strip or rewrite to proxy.
    node.children = node.children.filter((child) => {
      if (child.tagName === 'img') {
        const src = String(child.properties?.src ?? '');
        if (isExternal(src)) {
          if (options.imageProxy) {
            // Normalize protocol-relative URLs (//...) to https before proxying.
            const proxySrc = src.startsWith('//')
              ? `https:${src}`
              : src;
            // Rewrite to server-side proxy instead of stripping.
            child.properties!.src = withBasePath(
              `/api/image-proxy?url=${encodeURIComponent(proxySrc)}`,
            );
            return true;
          }
          return false; // Strip (default behavior).
        }
      }
      return true;
    });
    for (const child of node.children) {
      if (child.tagName === 'a' && child.properties) {
        const href = String(child.properties.href ?? '');
        if (isInVaultDocLink(href)) {
          const { path, suffix } = splitUrl(href);
          const normalized = normalizePath(path);
          child.properties.href = withBasePath(`/${normalized}`) + suffix;
        }
      }
      transform(child);
    }
  };
  return transform;
}

/** rehype plugin: rewrite in-vault links + strip/proxy external images. */
export function rehypeVaultLinks(options?: VaultLinksOptions) {
  const opts = options ?? {};
  return (tree: HastNode): void => createTransform(opts)(tree);
}
