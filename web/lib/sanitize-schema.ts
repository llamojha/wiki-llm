import { defaultSchema } from 'hast-util-sanitize';
import type { Schema } from 'hast-util-sanitize';

/**
 * Shared sanitize schema — the ONE sanitizer configuration for the entire
 * codebase (plan 028, STOP condition: no second sanitizer may exist). Used by
 * both `html.ts` (HTML documents) and `markdown.ts` (Markdown rendering).
 * Phase 8 HTML publishing must also share this schema.
 *
 * Extends GitHub's default schema with:
 *   - Inline `style=` attributes (denylist-based CSS filtering via a post-
 *     sanitize rehype transform — `rehypeFilterStyles`)
 *   - `data:image/*` protocol on `<img src>` (size-bounded, no SVG — see
 *     `rehypeFilterDataImages`)
 *
 * Permanently out (022 §2, non-negotiable):
 *   scripts, iframes, object/embed, event-handler attributes, `javascript:`
 *   URLs, `<style>` tags.
 */

export const vaultSanitizeSchema: Schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'style'],
    img: [...(defaultSchema.attributes?.img ?? []), 'src'],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), 'data'],
  },
};

/**
 * CSS property denylist — properties/values that are dangerous in inline
 * styles. Rather than allowlisting (too restrictive for fidelity), we strip
 * only the known-dangerous patterns. Every entry here is documented with
 * its attack vector.
 */

const DANGEROUS_PROPERTY_NAMES = new Set([
  'behavior',        // IE expression — `behavior: url(...)` executes HTC
  '-moz-binding',   // Firefox XBL binding — arbitrary code execution
]);

const DANGEROUS_POSITION_VALUES = new Set(['fixed', 'sticky']);

/**
 * Patterns in CSS values that are never safe in inline styles:
 *   - `expression(…)` — IE CSS expression, executes JS
 *   - `url(…)` — exfiltration / SSRF when used in background, list-style, etc.
 *   - `javascript:` — protocol in any value context
 *   - `import` — `@import` attempt in value
 */
const DANGEROUS_VALUE_PATTERNS = [
  /expression\s*\(/i,
  /url\s*\(/i,
  /javascript\s*:/i,
  /@import\s/i,
];

/**
 * Filter a single CSS declaration (property: value). Returns the declaration
 * unchanged if safe, or `null` if dangerous.
 */
export function filterStyleDeclaration(
  property: string,
  value: string,
): { property: string; value: string } | null {
  const propLower = property.trim().toLowerCase();
  const valLower = value.trim().toLowerCase();

  if (DANGEROUS_PROPERTY_NAMES.has(propLower)) return null;

  if (propLower === 'position' && DANGEROUS_POSITION_VALUES.has(valLower)) {
    return null;
  }

  for (const pattern of DANGEROUS_VALUE_PATTERNS) {
    if (pattern.test(valLower)) return null;
  }

  return { property: property.trim(), value: value.trim() };
}

/**
 * Parse and filter an inline `style` attribute value. Returns the safe subset
 * or an empty string if nothing survives.
 */
export function filterStyleAttribute(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const declarations = raw.split(';');
  const safe: string[] = [];

  for (const decl of declarations) {
    const colonIdx = decl.indexOf(':');
    if (colonIdx === -1) continue;

    const property = decl.slice(0, colonIdx);
    const value = decl.slice(colonIdx + 1);

    const result = filterStyleDeclaration(property, value);
    if (result) {
      safe.push(`${result.property}:${result.value}`);
    }
  }

  return safe.join(';');
}

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/**
 * Rehype transform: filters inline `style=` attributes through the denylist.
 * Runs AFTER `rehype-sanitize` (which now allows `style` through) to clean
 * dangerous CSS values. This is the security gate for inline styles.
 */
export function rehypeFilterStyles() {
  return (tree: HastNode): void => {
    walkStyles(tree);
  };
}

function walkStyles(node: HastNode): void {
  if (node.properties && typeof node.properties.style === 'string') {
    const filtered = filterStyleAttribute(node.properties.style);
    if (filtered) {
      node.properties.style = filtered;
    } else {
      delete node.properties.style;
    }
  }
  for (const child of node.children ?? []) {
    walkStyles(child);
  }
}

/**
 * Maximum size (in characters) for a `data:` URI on an `<img src>`. 128KB
 * covers most embedded screenshots. Exported for test use.
 */
export const DATA_IMAGE_MAX_SIZE = 128 * 1024;

/**
 * Allowed MIME prefixes for `data:` image URIs. SVG is explicitly excluded —
 * `data:image/svg+xml` can embed `<script>` and execute arbitrary code when
 * rendered by the browser.
 */
const DATA_IMAGE_ALLOWED_RE = /^data:image\/(?!svg\+xml)([\w.+-]+)/i;

/**
 * Rehype transform: filters `data:` URIs on `<img src>`. Strips images where:
 *   - The MIME type is not `image/*` (e.g. `data:text/html`)
 *   - The MIME type is `image/svg+xml` (XSS vector)
 *   - The URI exceeds `DATA_IMAGE_MAX_SIZE`
 *
 * Runs AFTER `rehype-sanitize`.
 */
export function rehypeFilterDataImages() {
  return (tree: HastNode): void => {
    walkDataImages(tree);
  };
}

function walkDataImages(node: HastNode): void {
  if (node.children) {
    node.children = node.children.filter((child) => {
      if (child.tagName === 'img') {
        const src = String(child.properties?.src ?? '');
        if (src.slice(0, 5).toLowerCase() === 'data:') {
          if (!DATA_IMAGE_ALLOWED_RE.test(src)) return false;
          if (src.length > DATA_IMAGE_MAX_SIZE) return false;
        }
      }
      return true;
    });
    for (const child of node.children) {
      walkDataImages(child);
    }
  }
}
