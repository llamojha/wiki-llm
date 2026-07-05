import { describe, expect, it } from 'vitest';

import { htmlText, htmlTitle, renderHtmlDocument } from '@/lib/html';

/**
 * Plan 022 sanitizer spike. HTML is the highest-risk render surface, so the
 * table pins the security contract: dangerous constructs stripped, safe
 * document structure preserved, full documents reduced to body content.
 */

describe('renderHtmlDocument — strips dangerous constructs', () => {
  const cases: Array<[string, string, string]> = [
    ['script tags', '<p>hi</p><script>alert(1)</script>', 'script'],
    ['inline event handlers', '<img src="x" onerror="alert(1)">', 'onerror'],
    ['javascript: hrefs', '<a href="javascript:alert(1)">x</a>', 'javascript:'],
    ['iframes', '<iframe src="https://evil.example"></iframe>', 'iframe'],
    ['object/embed', '<object data="x"></object><embed src="y">', 'object'],
    ['style tags', '<style>body{display:none}</style><p>ok</p>', '<style'],
    ['forms', '<form action="/steal"><input></form><p>ok</p>', '<form'],
  ];

  for (const [name, input, forbidden] of cases) {
    it(`removes ${name}`, async () => {
      const out = await renderHtmlDocument(input);
      expect(out.toLowerCase()).not.toContain(forbidden.toLowerCase());
    });
  }
});

describe('renderHtmlDocument — preserves safe content', () => {
  it('keeps headings, tables, links, images', async () => {
    const out = await renderHtmlDocument(
      '<h2>Title</h2><table><tr><td>cell</td></tr></table>' +
        '<a href="https://example.com">link</a><img src="/a.png" alt="a">',
    );
    expect(out).toContain('<h2>Title</h2>');
    expect(out).toContain('<table>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('<img');
    expect(out).toContain('alt="a"');
  });

  it('reduces a full document to its body content', async () => {
    const out = await renderHtmlDocument(
      '<!doctype html><html><head><title>T</title><script>x()</script></head>' +
        '<body><p>body text</p></body></html>',
    );
    expect(out).toContain('<p>body text</p>');
    expect(out).not.toContain('<title>');
    expect(out).not.toContain('x()');
    expect(out).not.toMatch(/<\/?html/i);
    expect(out).not.toMatch(/<\/?body/i);
  });
});

describe('htmlTitle', () => {
  it('prefers <title>, falls back to first <h1>, else null', () => {
    expect(htmlTitle('<html><head><title>Doc T</title></head><body><h1>H</h1></body></html>')).toBe('Doc T');
    expect(htmlTitle('<body><h1>Just H1</h1><p>x</p></body>')).toBe('Just H1');
    expect(htmlTitle('<p>no title anywhere</p>')).toBeNull();
  });
});

describe('htmlText', () => {
  it('extracts tag-free text and skips script/style bodies', () => {
    const text = htmlText('<h1>Hi</h1><style>.a{}</style><p>there</p><script>bad()</script>');
    expect(text).toBe('Hithere');
    expect(text).not.toContain('bad');
    expect(text).not.toContain('.a');
  });

  it('collapses whitespace and truncates to maxChars', () => {
    expect(htmlText('<p>a   b\n\nc</p>')).toBe('a b c');
    expect(htmlText('<p>abcdefghij</p>', 4)).toBe('abcd');
  });
});
