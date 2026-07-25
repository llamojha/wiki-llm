import { describe, expect, it } from 'vitest';

import { isImageContentType, validateProxyUrl } from '@/lib/image-proxy';

describe('validateProxyUrl — SSRF protection', () => {
  it('accepts valid http/https URLs', () => {
    expect(validateProxyUrl('https://example.com/image.png')).toBeNull();
    expect(validateProxyUrl('http://cdn.example.org/photo.jpg')).toBeNull();
    expect(validateProxyUrl('https://images.unsplash.com/photo-123?w=800')).toBeNull();
  });

  it('rejects non-http(s) protocols', () => {
    expect(validateProxyUrl('ftp://server/file.png')).toContain('Disallowed protocol');
    expect(validateProxyUrl('file:///etc/passwd')).toContain('Disallowed protocol');
    expect(validateProxyUrl('data:image/png;base64,abc')).toContain('Disallowed protocol');
    expect(validateProxyUrl('javascript:alert(1)')).toContain('Disallowed protocol');
  });

  it('rejects invalid URLs', () => {
    expect(validateProxyUrl('not a url')).toBe('Invalid URL');
    expect(validateProxyUrl('')).toBe('Invalid URL');
  });

  it('rejects loopback IPs (127.0.0.0/8)', () => {
    expect(validateProxyUrl('http://127.0.0.1/img.png')).toContain('Private IP');
    expect(validateProxyUrl('http://127.0.0.99/img.png')).toContain('Private IP');
  });

  it('rejects private 10.x IPs', () => {
    expect(validateProxyUrl('http://10.0.0.1/img.png')).toContain('Private IP');
    expect(validateProxyUrl('http://10.255.255.255/img.png')).toContain('Private IP');
  });

  it('rejects private 172.16.x IPs', () => {
    expect(validateProxyUrl('http://172.16.0.1/img.png')).toContain('Private IP');
    expect(validateProxyUrl('http://172.31.255.255/img.png')).toContain('Private IP');
  });

  it('rejects private 192.168.x IPs', () => {
    expect(validateProxyUrl('http://192.168.0.1/img.png')).toContain('Private IP');
    expect(validateProxyUrl('http://192.168.1.100/img.png')).toContain('Private IP');
  });

  it('rejects link-local 169.254.x IPs (IMDS)', () => {
    expect(validateProxyUrl('http://169.254.169.254/latest/meta-data')).toContain('Private IP');
  });

  it('rejects CGNAT 100.64.0.0/10 IPs (cloud-internal)', () => {
    expect(validateProxyUrl('http://100.64.0.1/img.png')).toContain('Private IP');
    expect(validateProxyUrl('http://100.100.100.100/img.png')).toContain('Private IP');
    expect(validateProxyUrl('http://100.127.255.255/img.png')).toContain('Private IP');
    // Neighbors outside the /10 stay reachable.
    expect(validateProxyUrl('http://100.63.255.255/img.png')).toBeNull();
    expect(validateProxyUrl('http://100.128.0.0/img.png')).toBeNull();
  });

  it('rejects localhost hostname', () => {
    expect(validateProxyUrl('http://localhost/img.png')).toContain('Disallowed hostname');
    expect(validateProxyUrl('http://localhost:3000/img.png')).toContain('Disallowed hostname');
  });

  it('rejects .local and .internal hostnames', () => {
    expect(validateProxyUrl('http://service.local/img.png')).toContain('Disallowed hostname');
    expect(validateProxyUrl('http://db.internal/img.png')).toContain('Disallowed hostname');
  });

  it('accepts public IPs', () => {
    expect(validateProxyUrl('http://8.8.8.8/img.png')).toBeNull();
    expect(validateProxyUrl('http://203.0.113.50/img.png')).toBeNull();
  });

  it('rejects IPv4-mapped IPv6 in hex form (::ffff:7f00:1)', () => {
    expect(validateProxyUrl('http://[::ffff:7f00:1]/img.png')).toContain('Private IP');
    expect(validateProxyUrl('http://[::ffff:a9fe:a9fe]/img.png')).toContain('Private IP'); // 169.254.169.254
    expect(validateProxyUrl('http://[::ffff:c0a8:101]/img.png')).toContain('Private IP'); // 192.168.1.1
    expect(validateProxyUrl('http://[::ffff:a00:1]/img.png')).toContain('Private IP'); // 10.0.0.1
  });

  it('rejects IPv4-mapped IPv6 in dotted form (::ffff:127.0.0.1)', () => {
    expect(validateProxyUrl('http://[::ffff:127.0.0.1]/img.png')).toContain('Private IP');
    expect(validateProxyUrl('http://[::ffff:169.254.169.254]/img.png')).toContain('Private IP');
  });

  it('rejects IPv6 loopback ::1', () => {
    expect(validateProxyUrl('http://[::1]/img.png')).toContain('Private IP');
  });

  it('rejects IPv6 unique-local (fc/fd)', () => {
    expect(validateProxyUrl('http://[fd12:3456::1]/img.png')).toContain('Private IP');
    expect(validateProxyUrl('http://[fc00::1]/img.png')).toContain('Private IP');
  });

  it('rejects IPv6 link-local (fe80::)', () => {
    expect(validateProxyUrl('http://[fe80::1]/img.png')).toContain('Private IP');
  });
});

describe('isImageContentType', () => {
  it('accepts image/* types', () => {
    expect(isImageContentType('image/png')).toBe(true);
    expect(isImageContentType('image/jpeg')).toBe(true);
    expect(isImageContentType('image/gif')).toBe(true);
    expect(isImageContentType('image/webp')).toBe(true);
    expect(isImageContentType('Image/PNG')).toBe(true);
    expect(isImageContentType(' image/png')).toBe(true);
  });

  it('rejects SVG to prevent XSS', () => {
    expect(isImageContentType('image/svg+xml')).toBe(false);
    expect(isImageContentType('image/svg')).toBe(false);
    expect(isImageContentType('Image/SVG+xml')).toBe(false);
  });

  it('rejects non-image types', () => {
    expect(isImageContentType('text/html')).toBe(false);
    expect(isImageContentType('application/json')).toBe(false);
    expect(isImageContentType('text/plain')).toBe(false);
    expect(isImageContentType(null)).toBe(false);
    expect(isImageContentType('')).toBe(false);
  });
});
