import { describe, expect, it } from 'vitest';

import { renderMarkdown } from '@/lib/markdown';

/**
 * `renderMarkdown` is the XSS boundary for all rendered vault content and
 * agent output. Assertions are on the sanitized OUTPUT (containment), never
 * on internal AST shapes or exact HTML strings — those are brittle across
 * rehype-sanitize upgrades.
 */
describe('renderMarkdown sanitization', () => {
  it('strips <script> tags', async () => {
    const html = await renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script');
  });

  it('drops javascript: hrefs', async () => {
    const html = await renderMarkdown('[x](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
  });

  it('strips inline event handlers', async () => {
    const html = await renderMarkdown('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('onerror');
  });

  it('strips <iframe>', async () => {
    const html = await renderMarkdown('<iframe src="https://evil.example"></iframe>');
    expect(html).not.toContain('<iframe');
  });

  it('does not render a leading frontmatter block as body text', async () => {
    const html = await renderMarkdown('---\ntitle: secret-title\n---\n\nBody here.');
    expect(html).not.toContain('secret-title');
    expect(html).toContain('Body here.');
  });
});

describe('renderMarkdown happy path', () => {
  it('adds an id to headings (rehype-slug)', async () => {
    const html = await renderMarkdown('# Getting Started');
    // rehype-sanitize prefixes ids with `user-content-` by default; assert
    // the slug is present in an id rather than the exact attribute value.
    expect(html).toMatch(/id="[^"]*getting-started"/);
  });

  it('renders GFM tables', async () => {
    const html = await renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table>');
  });

  it('renders fenced code blocks', async () => {
    const html = await renderMarkdown('```\nconst x = 1;\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('<code');
  });
});
