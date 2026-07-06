import { describe, expect, it } from 'vitest';

import { renderHtmlDocument } from '@/lib/html';
import { renderMarkdown } from '@/lib/markdown';

/**
 * One shared in-vault link resolver runs in BOTH render pipelines (plan 022):
 * relative `.md`/`.html` links are rewritten to portal `/[...id]` routes, and
 * external `<img>` are stripped (no outbound requests from a doc being read).
 * External/anchor/absolute links are left untouched.
 */
describe('in-vault link resolver (Markdown pipeline)', () => {
  it('rewrites a relative in-vault link to a portal route', async () => {
    const html = await renderMarkdown('See [the note](notes/foo.md).');
    expect(html).toContain('href="/notes/foo.md"');
  });

  it('leaves external and anchor links untouched', async () => {
    const html = await renderMarkdown('[ext](https://example.com) and [top](#intro)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="#intro"');
  });

  it('strips an external image', async () => {
    const html = await renderMarkdown('![x](https://evil.example/tracker.png)');
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('<img');
  });
});

describe('in-vault link resolver (HTML pipeline)', () => {
  it('rewrites a relative in-vault link and keeps the doc inert', async () => {
    const html = await renderHtmlDocument(
      '<html><body><a href="guides/setup.html">setup</a><script>alert(1)</script></body></html>',
    );
    expect(html).toContain('href="/guides/setup.html"');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('strips external images but keeps relative ones', async () => {
    const html = await renderHtmlDocument(
      '<body><img src="https://cdn.example/a.png"><img src="assets/local.png"></body>',
    );
    expect(html).not.toContain('cdn.example');
    expect(html).toContain('assets/local.png');
  });
});

describe('relative-link rewriting completeness (plan 028, task 4)', () => {
  it('preserves fragment on in-vault link', async () => {
    const html = await renderHtmlDocument('<a href="notes/setup.md#install">link</a>');
    expect(html).toContain('href="/notes/setup.md#install"');
  });

  it('preserves query on in-vault link', async () => {
    const html = await renderHtmlDocument('<a href="notes/setup.md?v=2">link</a>');
    expect(html).toContain('href="/notes/setup.md?v=2"');
  });

  it('preserves both query and fragment', async () => {
    const html = await renderHtmlDocument('<a href="notes/setup.md?v=2#install">link</a>');
    expect(html).toContain('href="/notes/setup.md?v=2#install"');
  });

  it('handles ./ prefix paths', async () => {
    const html = await renderHtmlDocument('<a href="./local/page.md">link</a>');
    expect(html).toContain('href="/local/page.md"');
  });

  it('handles ../ prefix paths', async () => {
    const html = await renderHtmlDocument('<a href="../other/page.html">link</a>');
    expect(html).toContain('href="/other/page.html"');
  });

  it('handles multiple ../ prefix paths', async () => {
    const html = await renderHtmlDocument('<a href="../../root/page.md">link</a>');
    expect(html).toContain('href="/root/page.md"');
  });

  it('leaves fragment-only links untouched', async () => {
    const html = await renderHtmlDocument('<a href="#local-anchor">link</a>');
    expect(html).toContain('href="#local-anchor"');
  });

  it('leaves query-only links untouched', async () => {
    const html = await renderHtmlDocument('<a href="?filter=active">link</a>');
    expect(html).toContain('href="?filter=active"');
  });

  it('leaves external links untouched', async () => {
    const html = await renderHtmlDocument('<a href="https://example.com/page.html">link</a>');
    expect(html).toContain('href="https://example.com/page.html"');
  });

  it('leaves non-doc relative links untouched (no .md/.html extension)', async () => {
    // TODO: future /api/assets/ route could handle these
    const html = await renderHtmlDocument('<a href="./images/diagram.png">link</a>');
    expect(html).toContain('href="./images/diagram.png"');
  });

  it('preserves relative <img src> for local assets', async () => {
    // TODO: future /api/assets/ route could resolve these
    const html = await renderHtmlDocument('<img src="./images/photo.png" alt="photo">');
    expect(html).toContain('src="./images/photo.png"');
  });
});
