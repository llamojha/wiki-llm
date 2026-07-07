import { describe, expect, it } from 'vitest';

import { renderHtmlDocument } from '@/lib/html';
import {
  DATA_IMAGE_MAX_SIZE,
  filterStyleAttribute,
  filterStyleDeclaration,
} from '@/lib/sanitize-schema';

describe('filterStyleDeclaration', () => {
  it('passes safe declarations through', () => {
    expect(filterStyleDeclaration('color', 'red')).toEqual({ property: 'color', value: 'red' });
    expect(filterStyleDeclaration('text-align', 'center')).toEqual({ property: 'text-align', value: 'center' });
    expect(filterStyleDeclaration('display', 'flex')).toEqual({ property: 'display', value: 'flex' });
    expect(filterStyleDeclaration('margin', '10px')).toEqual({ property: 'margin', value: '10px' });
    expect(filterStyleDeclaration('font-size', '18px')).toEqual({ property: 'font-size', value: '18px' });
    expect(filterStyleDeclaration('background-color', '#ff0000')).toEqual({ property: 'background-color', value: '#ff0000' });
    expect(filterStyleDeclaration('border', '1px solid black')).toEqual({ property: 'border', value: '1px solid black' });
    expect(filterStyleDeclaration('position', 'relative')).toEqual({ property: 'position', value: 'relative' });
    expect(filterStyleDeclaration('position', 'absolute')).toEqual({ property: 'position', value: 'absolute' });
  });

  it('strips expression() — IE CSS expression', () => {
    expect(filterStyleDeclaration('width', 'expression(alert(1))')).toBeNull();
    expect(filterStyleDeclaration('height', 'Expression( document.cookie )')).toBeNull();
  });

  it('strips url() — exfiltration vector', () => {
    expect(filterStyleDeclaration('background', 'url(http://evil.com/track.gif)')).toBeNull();
    expect(filterStyleDeclaration('background-image', 'url(javascript:alert(1))')).toBeNull();
    expect(filterStyleDeclaration('list-style', 'url("http://evil.com")')).toBeNull();
  });

  it('strips javascript: in values', () => {
    expect(filterStyleDeclaration('background', 'javascript:alert(1)')).toBeNull();
  });

  it('strips behavior — IE HTC execution', () => {
    expect(filterStyleDeclaration('behavior', 'url(xss.htc)')).toBeNull();
  });

  it('strips -moz-binding — Firefox XBL', () => {
    expect(filterStyleDeclaration('-moz-binding', 'url(xss.xml#xss)')).toBeNull();
  });

  it('strips position: fixed/sticky — overlay attacks', () => {
    expect(filterStyleDeclaration('position', 'fixed')).toBeNull();
    expect(filterStyleDeclaration('position', 'sticky')).toBeNull();
  });

  it('strips @import attempts', () => {
    expect(filterStyleDeclaration('color', '@import url(evil.css)')).toBeNull();
    expect(filterStyleDeclaration('color', '@import "evil.css"')).toBeNull();
  });
});

describe('filterStyleAttribute', () => {
  it('passes a fully safe style through', () => {
    const result = filterStyleAttribute('color: red; text-align: center; font-size: 18px');
    expect(result).toContain('color');
    expect(result).toContain('red');
    expect(result).toContain('text-align');
    expect(result).toContain('center');
    expect(result).toContain('font-size');
    expect(result).toContain('18px');
  });

  it('strips only dangerous declarations from a mixed style', () => {
    const result = filterStyleAttribute('color: red; background: url(http://evil); font-size: 14px');
    expect(result).toContain('color');
    expect(result).toContain('red');
    expect(result).toContain('font-size');
    expect(result).toContain('14px');
    expect(result).not.toContain('url');
    expect(result).not.toContain('evil');
  });

  it('returns empty string when all declarations are dangerous', () => {
    expect(filterStyleAttribute('behavior: url(xss.htc); -moz-binding: url(x)')).toBe('');
  });

  it('returns empty string for empty/whitespace input', () => {
    expect(filterStyleAttribute('')).toBe('');
    expect(filterStyleAttribute('   ')).toBe('');
  });

  it('handles declarations without values gracefully', () => {
    expect(filterStyleAttribute('color')).toBe('');
  });
});

describe('renderHtmlDocument — inline styles (plan 028)', () => {
  it('preserves safe inline styles', async () => {
    const out = await renderHtmlDocument(
      '<div style="color: red; text-align: center; font-size: 18px"><p>styled</p></div>',
    );
    expect(out).toContain('style=');
    expect(out).toContain('color');
    expect(out).toContain('red');
    expect(out).toContain('text-align');
    expect(out).toContain('center');
    expect(out).toContain('font-size');
    expect(out).toContain('18px');
  });

  it('strips expression() from inline styles', async () => {
    const out = await renderHtmlDocument(
      '<p style="width: expression(alert(1))">text</p>',
    );
    expect(out).not.toContain('expression');
    expect(out).not.toContain('alert');
  });

  it('strips url() from inline styles', async () => {
    const out = await renderHtmlDocument(
      '<p style="background: url(http://evil.com/track.gif)">text</p>',
    );
    expect(out).not.toContain('url(');
    expect(out).not.toContain('evil');
  });

  it('strips position:fixed from inline styles', async () => {
    const out = await renderHtmlDocument(
      '<div style="position: fixed; top: 0; left: 0; z-index: 9999">overlay</div>',
    );
    expect(out).not.toContain('position');
    // top and left are safe — they should survive
    expect(out).toContain('top');
  });

  it('keeps safe declarations and strips dangerous ones in mixed styles', async () => {
    const out = await renderHtmlDocument(
      '<p style="color: blue; behavior: url(xss.htc); margin: 5px">text</p>',
    );
    expect(out).toContain('color');
    expect(out).toContain('blue');
    expect(out).toContain('margin');
    expect(out).toContain('5px');
    expect(out).not.toContain('behavior');
    expect(out).not.toContain('xss');
  });
});

describe('renderHtmlDocument — data:image URIs (plan 028)', () => {
  const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  it('allows a small data:image/png', async () => {
    const out = await renderHtmlDocument(`<img src="${TINY_PNG}" alt="dot">`);
    expect(out).toContain('data:image/png;base64,');
    expect(out).toContain('alt="dot"');
  });

  it('strips data:text/html — not an image', async () => {
    const out = await renderHtmlDocument(
      '<img src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==" alt="xss">',
    );
    expect(out).not.toContain('data:text/html');
    expect(out).not.toContain('<img');
  });

  it('strips data:image/svg+xml — XSS vector', async () => {
    const out = await renderHtmlDocument(
      '<img src="data:image/svg+xml,<svg><script>alert(1)</script></svg>" alt="svg">',
    );
    expect(out).not.toContain('data:image/svg');
    expect(out).not.toContain('<img');
  });

  it('strips oversized data:image URIs', async () => {
    const bigPayload = 'A'.repeat(DATA_IMAGE_MAX_SIZE + 100);
    const out = await renderHtmlDocument(
      `<img src="data:image/png;base64,${bigPayload}" alt="big">`,
    );
    expect(out).not.toContain('<img');
  });
});
